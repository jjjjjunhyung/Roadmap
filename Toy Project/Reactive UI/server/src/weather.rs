//! Weather on a course's day, from Open-Meteo (free, no key).
//!
//! Where: the middle of the course's places (picked ones, else every candidate with a known
//! location), rounded to about a kilometre; central Seoul when none is known.
//! When: the forecast API covers about three months back to 15 days ahead; older days come
//! from the archive API; days further ahead are "far" and cost no request.
//! Answers are cached in SQLite: an hour for days still to come, for good once a day has passed.
//! Any failure just means "no weather".

use std::{
    sync::LazyLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

/// Seoul City Hall, for courses without any located place.
const FALLBACK: (f64, f64) = (37.5663, 126.9779);
const FORECAST_AHEAD: i64 = 15;
const FORECAST_BACK: i64 = 90;
const FRESH: i64 = 60 * 60;
const KST: i64 = 9 * 60 * 60;

static CLIENT: LazyLock<Option<Client>> = LazyLock::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .inspect_err(|e| tracing::warn!("weather: no http client: {e}"))
        .ok()
});

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Day {
    /// WMO weather code
    pub code: i64,
    pub max: f64,
    pub min: f64,
    /// percent; forecasts only
    pub rain_chance: Option<i64>,
    /// millimetres
    pub precip: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Hour {
    pub code: i64,
    pub temp: f64,
    pub rain_chance: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Report {
    /// "forecast" (today or later), "past", "far" (too far ahead), "none" (unavailable)
    pub status: String,
    /// days from today (Korea time) to the course's day
    pub days_until: Option<i64>,
    pub day: Option<Day>,
    /// 24 entries, local hours 0–23 (empty when unknown)
    pub hours: Vec<Hour>,
}

impl Report {
    fn empty(status: &str, days_until: Option<i64>) -> Self {
        Self {
            status: status.into(),
            days_until,
            day: None,
            hours: vec![],
        }
    }
}

/// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn day_number(date: &str) -> Option<i64> {
    let mut it = date.splitn(3, '-').map(|p| p.parse::<i64>().ok());
    let (y, m, d) = (it.next()??, it.next()??, it.next()??);
    Some(days_from_civil(y, m, d))
}

/// Today's day number in Korea.
fn today(now: i64) -> i64 {
    (now + KST).div_euclid(86_400)
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// A cached answer still holds: forever once fetched after its day ended, else for an hour.
fn fresh(day: i64, fetched_at: i64, now: i64) -> bool {
    today(fetched_at) > day || now - fetched_at < FRESH
}

/// The middle of the course's places, rounded to two decimals (about a kilometre).
async fn place(db: &SqlitePool, course_id: &str) -> (f64, f64) {
    let at = sqlx::query_as::<_, (Option<f64>, Option<f64>)>(
        "SELECT avg(c.lat), avg(c.lng) FROM candidates c JOIN steps s ON s.id = c.step_id \
         WHERE s.course_id = ? AND c.deleted_at IS NULL AND s.deleted_at IS NULL \
           AND c.lat IS NOT NULL AND c.lng IS NOT NULL \
           AND (s.picked_id IS NULL OR s.picked_id = c.id)",
    )
    .bind(course_id)
    .fetch_one(db)
    .await;
    let (lat, lng) = match at {
        Ok((Some(lat), Some(lng))) => (lat, lng),
        _ => FALLBACK,
    };
    let r = |v: f64| (v * 100.0).round() / 100.0;
    (r(lat), r(lng))
}

/// The weather on `date` around a course's places.
pub async fn for_course(db: &SqlitePool, course_id: &str, date: &str) -> Report {
    let Some(day) = day_number(date) else {
        return Report::empty("none", None);
    };
    let now = now();
    let until = day - today(now);
    if until > FORECAST_AHEAD {
        return Report::empty("far", Some(until));
    }
    let (lat, lng) = place(db, course_id).await;
    let key = format!("{date}:{lat:.2}:{lng:.2}");

    let cached = sqlx::query_as::<_, (String, i64)>(
        "SELECT body, fetched_at FROM weather_cache WHERE key = ?",
    )
    .bind(&key)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    if let Some((body, at)) = cached
        && fresh(day, at, now)
        && let Ok(mut r) = serde_json::from_str::<Report>(&body)
    {
        r.days_until = Some(until);
        r.status = if until < 0 { "past" } else { "forecast" }.into();
        return r;
    }

    let archive = until < -FORECAST_BACK;
    let mut report = match fetch(date, lat, lng, archive).await {
        Ok(json) => match parse(&json) {
            Some((day, hours)) => Report {
                status: if until < 0 { "past" } else { "forecast" }.into(),
                days_until: Some(until),
                day: Some(day),
                hours,
            },
            None => return Report::empty("none", Some(until)),
        },
        Err(e) => {
            tracing::warn!("weather: {e:#}");
            return Report::empty("none", Some(until));
        }
    };
    if let Ok(body) = serde_json::to_string(&report) {
        let _ = sqlx::query(
            "INSERT OR REPLACE INTO weather_cache (key, body, fetched_at) VALUES (?, ?, ?)",
        )
        .bind(&key)
        .bind(body)
        .bind(now)
        .execute(db)
        .await;
    }
    report.days_until = Some(until);
    report
}

async fn fetch(date: &str, lat: f64, lng: f64, archive: bool) -> anyhow::Result<Value> {
    let client = CLIENT
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("no http client"))?;
    let (base, daily, hourly) = if archive {
        (
            "https://archive-api.open-meteo.com/v1/archive",
            "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum",
            "temperature_2m,weather_code",
        )
    } else {
        (
            "https://api.open-meteo.com/v1/forecast",
            "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
            "temperature_2m,precipitation_probability,weather_code",
        )
    };
    let url = Url::parse_with_params(
        base,
        &[
            ("latitude", format!("{lat:.2}")),
            ("longitude", format!("{lng:.2}")),
            ("timezone", "Asia/Seoul".into()),
            ("start_date", date.into()),
            ("end_date", date.into()),
            ("daily", daily.into()),
            ("hourly", hourly.into()),
        ],
    )?;
    let res = client.get(url).send().await?;
    let status = res.status();
    let json: Value = serde_json::from_slice(&res.bytes().await?)?;
    if !status.is_success() {
        anyhow::bail!("open-meteo {status}: {}", json["reason"]);
    }
    Ok(json)
}

/// The day's summary and its 24 hours from an Open-Meteo answer (forecast or archive).
fn parse(json: &Value) -> Option<(Day, Vec<Hour>)> {
    let first = |section: &str, field: &str| json[section][field].get(0).cloned();
    let int = |v: Option<Value>| v.and_then(|v| v.as_f64()).map(|f| f.round() as i64);
    let float = |v: Option<Value>| v.and_then(|v| v.as_f64());
    let day = Day {
        code: int(first("daily", "weather_code"))?,
        max: float(first("daily", "temperature_2m_max"))?,
        min: float(first("daily", "temperature_2m_min"))?,
        rain_chance: int(first("daily", "precipitation_probability_max")),
        precip: float(first("daily", "precipitation_sum")),
    };
    let col = |field: &str| {
        json["hourly"][field]
            .as_array()
            .cloned()
            .unwrap_or_default()
    };
    let (codes, temps, rain) = (
        col("weather_code"),
        col("temperature_2m"),
        col("precipitation_probability"),
    );
    let hours = (0..temps.len().min(24))
        .map_while(|h| {
            Some(Hour {
                code: codes.get(h)?.as_f64()?.round() as i64,
                temp: temps.get(h)?.as_f64()?,
                rain_chance: rain
                    .get(h)
                    .and_then(Value::as_f64)
                    .map(|f| f.round() as i64),
            })
        })
        .collect::<Vec<_>>();
    Some((day, if hours.len() == 24 { hours } else { vec![] }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn counts_days() {
        assert_eq!(day_number("1970-01-01"), Some(0));
        assert_eq!(day_number("2000-03-01"), Some(11_017));
        assert_eq!(
            day_number("2026-12-24").unwrap() - day_number("2026-11-22").unwrap(),
            32
        );
        assert_eq!(
            day_number("2028-03-01").unwrap() - day_number("2028-02-28").unwrap(),
            2,
            "leap year"
        );
        assert_eq!(day_number("bad"), None);
        // 2026-11-22 00:30 KST is still 2026-11-21 in UTC
        let t = day_number("2026-11-21").unwrap() * 86_400 + 15 * 3600 + 1800;
        assert_eq!(today(t), day_number("2026-11-22").unwrap());
    }

    #[test]
    fn caches_past_days_for_good() {
        let day = day_number("2026-11-22").unwrap();
        let noon = (day * 86_400) - KST + 12 * 3600; // 12:00 KST that day
        assert!(fresh(day, noon, noon + 59 * 60));
        assert!(!fresh(day, noon, noon + 61 * 60), "same day: an hour");
        let next_morning = noon + 20 * 3600;
        assert!(
            fresh(day, next_morning, next_morning + 400 * 86_400),
            "after the day: kept"
        );
    }

    #[test]
    fn reads_forecasts_and_archives() {
        let hours = |n: usize, v: Value| vec![v; n];
        let forecast = json!({
            "daily": {
                "weather_code": [61], "temperature_2m_max": [10.7], "temperature_2m_min": [-1.3],
                "precipitation_probability_max": [70], "precipitation_sum": [3.2]
            },
            "hourly": {
                "weather_code": hours(24, json!(3)),
                "temperature_2m": hours(24, json!(6.2)),
                "precipitation_probability": hours(24, json!(40))
            }
        });
        let (day, hs) = parse(&forecast).unwrap();
        assert_eq!(day.code, 61);
        assert_eq!(day.rain_chance, Some(70));
        assert_eq!(hs.len(), 24);
        assert_eq!(hs[12].rain_chance, Some(40));

        let archive = json!({
            "daily": {
                "weather_code": [3], "temperature_2m_max": [3.1], "temperature_2m_min": [-3.1],
                "precipitation_sum": [0.0]
            },
            "hourly": { "weather_code": hours(24, json!(3)), "temperature_2m": hours(24, json!(2.1)) }
        });
        let (day, hs) = parse(&archive).unwrap();
        assert_eq!(day.rain_chance, None);
        assert_eq!(hs[0].rain_chance, None);

        assert!(parse(&json!({ "daily": { "weather_code": [null] } })).is_none());
    }
}
