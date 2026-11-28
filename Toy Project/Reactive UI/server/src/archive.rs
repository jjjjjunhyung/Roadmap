//! Archive (/api/archive): every course that has been shared, behind a short numeric passcode
//! (a birthday) instead of accounts. The right code sets a long-lived HttpOnly cookie derived
//! from the passcode and the planner key, so changing either signs every device out.
//!
//! A birthday is a small space, so guessing is made slow and visible:
//! - Cloudflare Turnstile (when configured) keeps scripts away from the form;
//! - every miss makes that address wait: a minute after the first, then 15 and 30 minutes;
//! - too many misses in a day from everyone lock the archive until the planner reopens it;
//! - every guess is stored (30 days) and listed on the planner page.

use std::{
    net::IpAddr,
    sync::LazyLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqliteConnection;

use crate::{
    AppState,
    error::{AppError, Result},
    plan::constant_time_eq,
};

const COOKIE: &str = "archive";
/// The wait after the 1st, 2nd and every later miss in a row (seconds): a slip costs a minute,
/// a second miss a quarter of an hour, then half an hour each.
const WAITS: [i64; 3] = [60, 15 * 60, 30 * 60];
/// Misses in a row are counted over this long.
const STREAK_WINDOW: i64 = 7 * 24 * 60 * 60;
/// Misses from everyone within a day that lock the archive until the planner reopens it.
pub const DAILY_LIMIT: i64 = 20;
const DAY: i64 = 24 * 60 * 60;
const KEEP: i64 = 30 * DAY;
const LOCKED: &str = "틀린 시도가 많아서 잠가 뒀어. 준비한 사람에게 풀어 달라고 해 줘";
/// Turnstile action name; the widget on the page uses the same one.
const ACTION: &str = "archive";

pub struct Archive {
    passcode: String,
    token: String,
    turnstile: Option<Turnstile>,
    /// one guess at a time, so parallel requests cannot slip past the limits
    gate: tokio::sync::Mutex<()>,
}

/// Cloudflare Turnstile keys: the site key goes to the page, the secret stays here.
struct Turnstile {
    site_key: String,
    secret: String,
}

impl Archive {
    /// `passcode` must be 4 to 8 digits; `secret` (the planner key) makes the cookie unguessable.
    pub fn new(passcode: &str, secret: &str) -> Option<Self> {
        let passcode = passcode.trim();
        if !(4..=8).contains(&passcode.len()) || !passcode.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let digest = Sha256::new()
            .chain_update(b"archive\0")
            .chain_update(secret.as_bytes())
            .chain_update(b"\0")
            .chain_update(passcode.as_bytes())
            .finalize();
        let token = digest.iter().map(|b| format!("{b:02x}")).collect();
        Some(Self {
            passcode: passcode.to_owned(),
            token,
            turnstile: None,
            gate: tokio::sync::Mutex::new(()),
        })
    }

    /// Require a Turnstile pass before every guess.
    pub fn with_turnstile(mut self, site_key: &str, secret: &str) -> Self {
        self.turnstile = Some(Turnstile {
            site_key: site_key.trim().to_owned(),
            secret: secret.trim().to_owned(),
        });
        self
    }

    /// How many digits to ask for.
    pub fn digits(&self) -> usize {
        self.passcode.len()
    }

    /// The public Turnstile key for the page, when the form needs one.
    pub fn turnstile_site_key(&self) -> Option<&str> {
        self.turnstile.as_ref().map(|t| t.site_key.as_str())
    }

    fn signed_in(&self, headers: &HeaderMap) -> bool {
        cookie(headers, COOKIE)
            .is_some_and(|t| constant_time_eq(t.as_bytes(), self.token.as_bytes()))
    }
}

// ------------------------------------------------------------------ rules

/// Seconds an address still has to wait, after `streak` misses in a row, the last one
/// `since_last` seconds ago.
fn wait_left(streak: usize, since_last: i64) -> i64 {
    if streak == 0 {
        return 0;
    }
    let wait = WAITS[(streak - 1).min(WAITS.len() - 1)];
    (wait - since_last).max(0)
}

/// "1분", "10분", "1시간", "하루" — rounded up.
fn spoken(secs: i64) -> String {
    if secs <= 60 {
        "1분".into()
    } else if secs < 3600 {
        format!("{}분", (secs + 59) / 60)
    } else if secs < DAY {
        format!("{}시간", (secs + 3599) / 3600)
    } else {
        "하루".into()
    }
}

fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|kv| kv.trim().strip_prefix(name)?.strip_prefix('='))
}

/// Who the limits apply to: the IPv4 address, or the IPv6 /64 (one home or phone gets a whole
/// /64, so counting single IPv6 addresses would let one device rotate freely).
fn address(ip: Option<IpAddr>) -> String {
    match ip {
        Some(IpAddr::V6(v6)) if v6.to_ipv4_mapped().is_none() => {
            let s = v6.segments();
            format!("{:x}:{:x}:{:x}:{:x}::/64", s[0], s[1], s[2], s[3])
        }
        Some(IpAddr::V6(v6)) => v6
            .to_ipv4_mapped()
            .map_or("unknown".into(), |v4| v4.to_string()),
        Some(IpAddr::V4(v4)) => v4.to_string(),
        None => "unknown".into(),
    }
}

/// For the planner page: enough to tell places apart, not a full address.
fn masked(address: &str) -> String {
    match address.rsplit_once('.') {
        Some((head, _)) if !address.contains(':') => format!("{head}.*"),
        _ => address.to_owned(),
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

// ------------------------------------------------------------------ lock state

async fn setting(conn: &mut SqliteConnection, key: &str) -> Result<Option<i64>> {
    let v: Option<String> = sqlx::query_scalar("SELECT value FROM app_info WHERE key = ?")
        .bind(key)
        .fetch_optional(&mut *conn)
        .await?;
    Ok(v.and_then(|v| v.parse().ok()))
}

async fn set_setting(conn: &mut SqliteConnection, key: &str, value: Option<i64>) -> Result<()> {
    match value {
        Some(v) => {
            sqlx::query("INSERT OR REPLACE INTO app_info (key, value) VALUES (?, ?)")
                .bind(key)
                .bind(v.to_string())
                .execute(&mut *conn)
                .await?
        }
        None => {
            sqlx::query("DELETE FROM app_info WHERE key = ?")
                .bind(key)
                .execute(&mut *conn)
                .await?
        }
    };
    Ok(())
}

/// Misses since `since` from everyone.
async fn misses_since(conn: &mut SqliteConnection, since: i64) -> Result<i64> {
    Ok(
        sqlx::query_scalar("SELECT count(*) FROM archive_attempts WHERE ok = 0 AND at > ?")
            .bind(since)
            .fetch_one(&mut *conn)
            .await?,
    )
}

// ------------------------------------------------------------------ turnstile

static CLIENT: LazyLock<Option<reqwest::Client>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .inspect_err(|e| tracing::warn!("turnstile: no http client: {e}"))
        .ok()
});

#[derive(Deserialize)]
struct Siteverify {
    success: bool,
    #[serde(default)]
    action: String,
    #[serde(default, rename = "error-codes")]
    error_codes: Vec<String>,
}

impl Siteverify {
    fn passes(&self) -> bool {
        self.success && (self.action.is_empty() || self.action == ACTION)
    }
}

impl Turnstile {
    /// Fails closed: when Cloudflare cannot be asked, nobody gets to guess.
    async fn verify(&self, token: &str, ip: Option<IpAddr>) -> Result<()> {
        if token.is_empty() || token.len() > 2048 {
            return Err(AppError::Forbidden("사람 확인이 아직 안 끝났어".into()));
        }
        let client = CLIENT
            .as_ref()
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("turnstile: no http client")))?;
        let mut body = serde_json::json!({ "secret": self.secret, "response": token });
        if let Some(ip) = ip {
            body["remoteip"] = ip.to_string().into();
        }
        let res = client
            .post("https://challenges.cloudflare.com/turnstile/v0/siteverify")
            .header(header::CONTENT_TYPE, "application/json")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
        let bytes = res
            .bytes()
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
        let v: Siteverify =
            serde_json::from_slice(&bytes).map_err(|e| AppError::Internal(e.into()))?;
        if v.passes() {
            Ok(())
        } else {
            tracing::warn!(codes = ?v.error_codes, action = %v.action, "turnstile: rejected");
            Err(AppError::Forbidden(
                "사람 확인에 실패했어. 화면을 새로 고쳐 줘".into(),
            ))
        }
    }
}

// ------------------------------------------------------------------ routes

/// Routes behind the birthday (the list, the album) call this first.
pub(crate) fn require(st: &AppState, headers: &HeaderMap) -> Result<()> {
    if archive(st)?.signed_in(headers) {
        Ok(())
    } else {
        Err(AppError::Unauthorized("생일을 먼저 입력해 줘"))
    }
}

fn archive(st: &AppState) -> Result<&Archive> {
    st.archive
        .as_deref()
        .ok_or(AppError::NotFound("아직 열리지 않았어"))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/archive", get(list))
        .route("/archive/unlock", post(unlock))
        .route("/archive/lock", post(lock))
}

/// For the planner API (behind its key): the guard's state and how to reopen it.
pub fn planner_router() -> Router<AppState> {
    Router::new()
        .route("/archive", get(guard))
        .route("/archive/reopen", post(reopen))
}

#[derive(Serialize)]
struct Stop {
    label: String,
    kind: String,
    time: String,
    /// where they went: the picked place, or where they went instead on the day; null while
    /// the step is still to be chosen
    name: Option<String>,
    image_url: Option<String>,
    /// "replaced" | "skipped" when the day changed the plan (name is then the new place, or
    /// still the planned one for a skipped stop); "added" for a place they dropped by
    changed: Option<&'static str>,
}

#[derive(Serialize)]
struct Memory {
    share_code: String,
    title: String,
    date: String,
    /// "open" | "done" (drafts stay a surprise)
    status: String,
    stops: Vec<Stop>,
    /// our own photos of the day (up to four, oldest first) for the card
    photos: Vec<String>,
}

#[derive(sqlx::FromRow)]
struct StopRow {
    course_id: String,
    step_id: String,
    label: String,
    kind: String,
    time: String,
    name: Option<String>,
    image_url: Option<String>,
    skipped: Option<bool>,
    actual_name: Option<String>,
    actual_image: Option<String>,
}

async fn list(State(st): State<AppState>, headers: HeaderMap) -> Result<Response> {
    require(&st, &headers)?;
    let courses = sqlx::query_as::<_, (String, String, String, String, String)>(
        "SELECT id, share_code, title, date, status FROM courses \
         WHERE deleted_at IS NULL AND status != 'draft' ORDER BY date DESC, created_at DESC",
    )
    .fetch_all(&st.db)
    .await?;
    let rows = sqlx::query_as::<_, StopRow>(
        "SELECT s.course_id, s.id AS step_id, s.label, s.kind, s.time, c.name, c.image_url, \
           a.skipped, a.name AS actual_name, a.image_url AS actual_image FROM steps s \
         JOIN courses k ON k.id = s.course_id \
         LEFT JOIN candidates c ON c.id = s.picked_id AND c.deleted_at IS NULL \
         LEFT JOIN step_actual a ON a.step_id = s.id AND c.id IS NOT NULL \
         WHERE s.deleted_at IS NULL AND k.deleted_at IS NULL AND k.status != 'draft' \
         ORDER BY s.position, s.rowid",
    )
    .fetch_all(&st.db)
    .await?;
    let mut photos: std::collections::HashMap<String, Vec<String>> = Default::default();
    for (course, id) in sqlx::query_as::<_, (String, String)>(
        "SELECT course_id, id FROM photos ORDER BY created_at, rowid",
    )
    .fetch_all(&st.db)
    .await?
    {
        let ids = photos.entry(course).or_default();
        if ids.len() < 4 {
            ids.push(id);
        }
    }
    // places they dropped by, each after the stop it followed (or at the end)
    let mut extras: std::collections::HashMap<String, Vec<(Option<String>, Stop)>> =
        Default::default();
    for (course, after, time, kind, name, image) in
        sqlx::query_as::<_, (String, Option<String>, String, String, String, String)>(
            "SELECT course_id, after_step_id, time, kind, name, image_url FROM extra_stops \
             ORDER BY time = '', time, created_at, rowid",
        )
        .fetch_all(&st.db)
        .await?
    {
        extras.entry(course).or_default().push((
            after,
            Stop {
                label: crate::validate::kind_label(&kind).into(),
                kind,
                time,
                name: Some(name),
                image_url: Some(image).filter(|u| !u.is_empty()),
                changed: Some("added"),
            },
        ));
    }
    let mut stops: std::collections::HashMap<String, Vec<Stop>> = Default::default();
    for r in rows {
        let after_this: Vec<Stop> = match extras.get_mut(&r.course_id) {
            Some(xs) => {
                let (mine, rest): (Vec<_>, Vec<_>) = xs
                    .drain(..)
                    .partition(|(a, _)| a.as_deref() == Some(r.step_id.as_str()));
                *xs = rest;
                mine.into_iter().map(|(_, s)| s).collect()
            }
            None => vec![],
        };
        let (name, image_url, changed) = match r.skipped {
            Some(true) => (r.name, r.image_url, Some("skipped")),
            Some(false) => (r.actual_name, r.actual_image, Some("replaced")),
            None => (r.name, r.image_url, None),
        };
        let list = stops.entry(r.course_id).or_default();
        list.push(Stop {
            label: r.label,
            kind: r.kind,
            time: r.time,
            image_url: image_url.filter(|u| !u.is_empty()),
            name,
            changed,
        });
        list.extend(after_this);
    }
    // extras whose stop is gone (or that came last) close the day
    for (course, rest) in extras {
        stops
            .entry(course)
            .or_default()
            .extend(rest.into_iter().map(|(_, s)| s));
    }
    let memories: Vec<Memory> = courses
        .into_iter()
        .map(|(id, share_code, title, date, status)| Memory {
            stops: stops.remove(&id).unwrap_or_default(),
            photos: photos.remove(&id).unwrap_or_default(),
            share_code,
            title,
            date,
            status,
        })
        .collect();
    Ok(private(Json(memories).into_response()))
}

#[derive(Deserialize)]
struct Unlock {
    code: String,
    #[serde(default)]
    turnstile: String,
}

async fn unlock(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Unlock>,
) -> Result<Response> {
    let a = archive(&st)?;
    let ip = crate::client_ip(st.origin_secret.as_deref(), &headers);
    if let Some(t) = &a.turnstile {
        t.verify(&body.turnstile, ip).await?;
    }
    let addr = address(ip);
    let agent: String = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .chars()
        .take(300)
        .collect();
    let code: String = body.code.chars().filter(char::is_ascii_digit).collect();

    let _one_at_a_time = a.gate.lock().await;
    let now = now();
    let mut conn = st.db.acquire().await?;
    if setting(&mut conn, "archive_locked_at").await?.is_some() {
        return Err(AppError::TooManyRequests(LOCKED.into()));
    }
    let cleared = setting(&mut conn, "archive_cleared_at").await?.unwrap_or(0);

    // this address's latest guesses: misses since its last success
    let recent = sqlx::query_as::<_, (i64, i64)>(
        "SELECT ok, at FROM archive_attempts WHERE address = ? AND at > ? ORDER BY id DESC LIMIT 16",
    )
    .bind(&addr)
    .bind((now - STREAK_WINDOW).max(cleared))
    .fetch_all(&mut *conn)
    .await?;
    let streak = recent.iter().take_while(|(ok, _)| *ok == 0).count();
    let last = recent.first().map_or(0, |(_, at)| *at);
    let left = wait_left(streak, now - last);
    if left > 0 {
        return Err(AppError::Wait {
            status: StatusCode::TOO_MANY_REQUESTS,
            message: format!("아직 기다려야 해. {} 뒤에 다시 해 줘", spoken(left)),
            after: left,
        });
    }

    let ok = constant_time_eq(code.as_bytes(), a.passcode.as_bytes());
    sqlx::query("INSERT INTO archive_attempts (address, agent, ok, at) VALUES (?, ?, ?, ?)")
        .bind(&addr)
        .bind(&agent)
        .bind(ok as i64)
        .bind(now)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM archive_attempts WHERE at < ?")
        .bind(now - KEEP)
        .execute(&mut *conn)
        .await?;
    if ok {
        return Ok(with_cookie(&a.token, 400 * DAY as u64));
    }

    if misses_since(&mut conn, (now - DAY).max(cleared)).await? >= DAILY_LIMIT {
        set_setting(&mut conn, "archive_locked_at", Some(now)).await?;
        tracing::warn!("archive: locked after {DAILY_LIMIT} misses in a day");
        return Err(AppError::TooManyRequests(LOCKED.into()));
    }
    let wait = wait_left(streak + 1, 0);
    Err(AppError::Wait {
        status: StatusCode::FORBIDDEN,
        message: format!("아니야. {} 뒤에 다시 해 줘", spoken(wait)),
        after: wait,
    })
}

async fn lock() -> Response {
    with_cookie("", 0)
}

fn with_cookie(value: &str, max_age: u64) -> Response {
    let mut res = StatusCode::NO_CONTENT.into_response();
    let c = format!(
        "{COOKIE}={value}; Path=/api/archive; Max-Age={max_age}; HttpOnly; Secure; SameSite=Strict"
    );
    if let Ok(v) = HeaderValue::from_str(&c) {
        res.headers_mut().insert(header::SET_COOKIE, v);
    }
    private(res)
}

pub(crate) fn private(mut res: Response) -> Response {
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

// ------------------------------------------------------------------ planner

#[derive(Serialize)]
struct Guard {
    /// false when no passcode is configured
    enabled: bool,
    turnstile: bool,
    /// unix seconds; set while the archive is locked
    locked_at: Option<i64>,
    misses_today: i64,
    daily_limit: i64,
    recent: Vec<Attempt>,
}

#[derive(Serialize, sqlx::FromRow)]
struct Attempt {
    at: i64,
    ok: bool,
    address: String,
    agent: String,
}

async fn guard_view(st: &AppState) -> Result<Guard> {
    let mut conn = st.db.acquire().await?;
    let cleared = setting(&mut conn, "archive_cleared_at").await?.unwrap_or(0);
    let mut recent = sqlx::query_as::<_, Attempt>(
        "SELECT at, ok, address, agent FROM archive_attempts ORDER BY id DESC LIMIT 12",
    )
    .fetch_all(&mut *conn)
    .await?;
    for r in &mut recent {
        r.address = masked(&r.address);
    }
    Ok(Guard {
        enabled: st.archive.is_some(),
        turnstile: st.archive.as_ref().is_some_and(|a| a.turnstile.is_some()),
        locked_at: setting(&mut conn, "archive_locked_at").await?,
        misses_today: misses_since(&mut conn, (now() - DAY).max(cleared)).await?,
        daily_limit: DAILY_LIMIT,
        recent,
    })
}

async fn guard(State(st): State<AppState>) -> Result<Json<Guard>> {
    Ok(Json(guard_view(&st).await?))
}

/// Lifts the lock and forgives every miss so far (the history stays).
async fn reopen(State(st): State<AppState>) -> Result<Json<Guard>> {
    {
        let mut conn = st.db.acquire().await?;
        set_setting(&mut conn, "archive_locked_at", None).await?;
        set_setting(&mut conn, "archive_cleared_at", Some(now())).await?;
    }
    Ok(Json(guard_view(&st).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passcode_shape() {
        assert!(Archive::new("123456", "k").is_some());
        assert!(Archive::new(" 1234 ", "k").is_some());
        assert!(Archive::new("123", "k").is_none());
        assert!(Archive::new("123456789", "k").is_none());
        assert!(Archive::new("12-34-56", "k").is_none());
    }

    #[test]
    fn token_depends_on_both_secrets() {
        let a = Archive::new("123456", "k1").unwrap();
        assert_ne!(a.token, Archive::new("123456", "k2").unwrap().token);
        assert_ne!(a.token, Archive::new("654321", "k1").unwrap().token);
        assert_eq!(a.token.len(), 64);
    }

    #[test]
    fn every_miss_waits_and_the_second_much_longer() {
        assert_eq!(wait_left(0, 0), 0);
        assert_eq!(wait_left(1, 0), 60);
        assert_eq!(wait_left(1, 59), 1);
        assert_eq!(wait_left(1, 60), 0);
        assert_eq!(wait_left(2, 0), 15 * 60);
        assert_eq!(wait_left(3, 0), 30 * 60);
        assert_eq!(wait_left(9, 0), 30 * 60);
        assert_eq!(wait_left(9, 30 * 60), 0);
        assert_eq!(spoken(15 * 60), "15분");
        assert_eq!(spoken(30 * 60), "30분");
    }

    #[test]
    fn speaks_waits_in_korean() {
        assert_eq!(spoken(1), "1분");
        assert_eq!(spoken(60), "1분");
        assert_eq!(spoken(61), "2분");
        assert_eq!(spoken(600), "10분");
        assert_eq!(spoken(3600), "1시간");
        assert_eq!(spoken(5000), "2시간");
        assert_eq!(spoken(DAY), "하루");
    }

    #[test]
    fn groups_addresses() {
        let ip = |s: &str| Some(s.parse::<IpAddr>().unwrap());
        assert_eq!(address(ip("203.0.113.7")), "203.0.113.7");
        assert_eq!(
            address(ip("2001:db8:1:2:aaaa:bbbb:cccc:dddd")),
            "2001:db8:1:2::/64"
        );
        assert_eq!(
            address(ip("2001:db8:1:2::1")),
            address(ip("2001:db8:1:2:ffff::9"))
        );
        assert_eq!(address(ip("::ffff:203.0.113.7")), "203.0.113.7");
        assert_eq!(address(None), "unknown");
        assert_eq!(masked("203.0.113.7"), "203.0.113.*");
        assert_eq!(masked("2001:db8:1:2::/64"), "2001:db8:1:2::/64");
    }

    #[test]
    fn reads_the_cookie() {
        let mut h = HeaderMap::new();
        h.insert(
            header::COOKIE,
            HeaderValue::from_static("a=1; archive=xyz; b=2"),
        );
        assert_eq!(cookie(&h, "archive"), Some("xyz"));
        assert_eq!(cookie(&h, "arch"), None);
        assert_eq!(cookie(&h, "c"), None);
    }

    #[test]
    fn turnstile_answer() {
        let v = |s: &str| serde_json::from_str::<Siteverify>(s).unwrap().passes();
        assert!(v(r#"{"success":true,"action":"archive"}"#));
        assert!(v(r#"{"success":true}"#));
        assert!(!v(r#"{"success":true,"action":"login"}"#));
        assert!(!v(
            r#"{"success":false,"error-codes":["invalid-input-response"]}"#
        ));
    }
}
