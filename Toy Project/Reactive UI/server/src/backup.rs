//! Daily backup of the whole database (courses, photos, everything) to Object Storage.
//!
//! Once a day (04:00 in Korea, or a minute after start when the last good backup is older than a
//! day) the server writes a consistent copy with `VACUUM INTO` beside the database, uploads it
//! through a write-only pre-authenticated URL (BACKUP_URL: it can add objects, not read, list or
//! delete them), and removes the local copy. The bucket's lifecycle rule expires old copies.
//! The planner page shows the last success or why the last try failed, and can start one.

use std::{
    path::PathBuf,
    sync::LazyLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::Context;
use axum::{Json, Router, extract::State, routing::get};
use reqwest::{Client, header};
use serde::Serialize;
use sqlx::SqlitePool;

use crate::{
    AppState,
    error::{AppError, Result},
};

const KST: i64 = 9 * 60 * 60;
const DAY: i64 = 24 * 60 * 60;
/// 04:00 in Korea, as seconds into the UTC day.
const AT: i64 = (4 * 60 * 60 - KST).rem_euclid(DAY);

pub struct Backup {
    /// Upload prefix; the object name is appended.
    url: String,
    /// Where the temporary copy is written (the database's own directory, so there is room).
    dir: PathBuf,
    /// One backup at a time.
    running: tokio::sync::Mutex<()>,
}

impl Backup {
    pub fn new(url: &str, dir: PathBuf) -> Option<Self> {
        let url = url.trim();
        (url.starts_with("https://") || url.starts_with("http://")).then(|| Self {
            url: url.to_owned(),
            dir,
            running: tokio::sync::Mutex::new(()),
        })
    }
}

static CLIENT: LazyLock<Option<Client>> = LazyLock::new(|| {
    Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(30 * 60))
        .build()
        .inspect_err(|e| tracing::warn!("backup: no http client: {e}"))
        .ok()
});

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// (year, month, day) of a day number (days since 1970-01-01; Howard Hinnant's algorithm).
fn civil(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// "app-20261123-040000.db", in Korea time.
fn object_name(unix: i64) -> String {
    let t = unix + KST;
    let (y, m, d) = civil(t.div_euclid(DAY));
    let s = t.rem_euclid(DAY);
    format!(
        "app-{y:04}{m:02}{d:02}-{:02}{:02}{:02}.db",
        s / 3600,
        s / 60 % 60,
        s % 60
    )
}

/// Seconds until the next 04:00 in Korea.
fn until_next(now: i64) -> i64 {
    let into = now.rem_euclid(DAY);
    let wait = (AT - into).rem_euclid(DAY);
    if wait == 0 { DAY } else { wait }
}

async fn setting(db: &SqlitePool, key: &str) -> Option<String> {
    sqlx::query_scalar("SELECT value FROM app_info WHERE key = ?")
        .bind(key)
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
}

async fn record(db: &SqlitePool, pairs: &[(&str, String)]) {
    for (k, v) in pairs {
        let _ = sqlx::query("INSERT OR REPLACE INTO app_info (key, value) VALUES (?, ?)")
            .bind(k)
            .bind(v)
            .execute(db)
            .await;
    }
}

/// One backup: copy, upload, clean up. Returns the bytes uploaded.
pub async fn run_once(db: &SqlitePool, b: &Backup) -> anyhow::Result<u64> {
    let _one = b.running.lock().await;
    let at = now();
    let name = object_name(at);
    let copy = b.dir.join(format!(".{name}"));
    let _ = tokio::fs::remove_file(&copy).await;
    let result = async {
        sqlx::query("VACUUM INTO ?")
            .bind(copy.to_string_lossy().as_ref())
            .execute(db)
            .await
            .context("copy the database")?;
        let file = tokio::fs::File::open(&copy)
            .await
            .context("open the copy")?;
        let len = file.metadata().await?.len();
        let client = CLIENT.as_ref().context("no http client")?;
        let res = client
            .put(format!("{}{name}", b.url))
            .header(header::CONTENT_LENGTH, len)
            .header(header::CONTENT_TYPE, "application/vnd.sqlite3")
            .body(file)
            .send()
            .await
            .context("upload")?;
        let status = res.status();
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            anyhow::bail!(
                "upload refused: {status} {}",
                body.chars().take(200).collect::<String>()
            );
        }
        Ok(len)
    }
    .await;
    let _ = tokio::fs::remove_file(&copy).await;
    match &result {
        Ok(len) => {
            tracing::info!(object = %name, bytes = len, "backup uploaded");
            record(
                db,
                &[
                    ("backup_last_ok", at.to_string()),
                    ("backup_last_bytes", len.to_string()),
                ],
            )
            .await;
        }
        Err(e) => {
            tracing::error!("backup failed: {e:#}");
            record(
                db,
                &[
                    ("backup_last_error", format!("{e:#}")),
                    ("backup_last_error_at", at.to_string()),
                ],
            )
            .await;
        }
    }
    result
}

/// Runs backups for as long as the server does.
pub fn spawn(db: SqlitePool, b: std::sync::Arc<Backup>) {
    tokio::spawn(async move {
        let last: i64 = setting(&db, "backup_last_ok")
            .await
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        if now() - last > DAY + 2 * 60 * 60 {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let _ = run_once(&db, &b).await;
        }
        loop {
            tokio::time::sleep(Duration::from_secs(until_next(now()) as u64)).await;
            let _ = run_once(&db, &b).await;
        }
    });
}

// ------------------------------------------------------------------ planner

pub fn planner_router() -> Router<AppState> {
    Router::new().route("/backup", get(status).post(run_now))
}

#[derive(Serialize)]
struct Status {
    configured: bool,
    /// unix seconds
    last_ok: Option<i64>,
    last_bytes: Option<i64>,
    last_error: Option<String>,
    last_error_at: Option<i64>,
}

async fn status_of(st: &AppState) -> Status {
    let num = |v: Option<String>| v.and_then(|v| v.parse().ok());
    let last_ok = num(setting(&st.db, "backup_last_ok").await);
    let last_error_at = num(setting(&st.db, "backup_last_error_at").await);
    // an error older than the last success is history
    let stale = matches!((last_ok, last_error_at), (Some(ok), Some(err)) if ok >= err);
    Status {
        configured: st.backup.is_some(),
        last_ok,
        last_bytes: num(setting(&st.db, "backup_last_bytes").await),
        last_error: if stale {
            None
        } else {
            setting(&st.db, "backup_last_error").await
        },
        last_error_at: if stale { None } else { last_error_at },
    }
}

async fn status(State(st): State<AppState>) -> Json<Status> {
    Json(status_of(&st).await)
}

/// Backs up now (the planner's button); answers with the new status either way.
async fn run_now(State(st): State<AppState>) -> Result<Json<Status>> {
    let b = st
        .backup
        .clone()
        .ok_or(AppError::NotFound("백업이 설정되지 않았어 (BACKUP_URL)"))?;
    let _ = run_once(&st.db, &b).await;
    Ok(Json(status_of(&st).await))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_backups_in_korea_time() {
        // day 20779 is 2026-11-22; 19:00 UTC that day is 04:00 on the 23rd in Korea
        assert_eq!(civil(20_779), (2026, 11, 22));
        assert_eq!(
            object_name(20_779 * DAY + 19 * 3600),
            "app-20261123-040000.db"
        );
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(11_017), (2000, 3, 1));
    }

    #[test]
    fn waits_for_four_in_the_morning() {
        let midnight_utc = 20_779 * DAY;
        assert_eq!(until_next(midnight_utc), 19 * 3600);
        assert_eq!(
            until_next(midnight_utc + 19 * 3600),
            DAY,
            "just ran: tomorrow"
        );
        assert_eq!(until_next(midnight_utc + 20 * 3600), 23 * 3600);
    }

    #[test]
    fn needs_a_url() {
        assert!(Backup::new("", PathBuf::from(".")).is_none());
        assert!(Backup::new("ftp://x", PathBuf::from(".")).is_none());
        assert!(
            Backup::new(" https://objectstorage.example/p/x/o/ ", PathBuf::from(".")).is_some()
        );
    }
}
