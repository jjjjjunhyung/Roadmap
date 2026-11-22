//! Archive (/api/archive): every course that has been shared, behind a short numeric passcode
//! (a birthday) instead of accounts. The right code sets a long-lived HttpOnly cookie derived
//! from the passcode and the planner key, so changing either signs every device out. A birthday
//! is a small space, so wrong guesses are limited per address and overall.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
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

use crate::{
    AppState,
    error::{AppError, Result},
    plan::constant_time_eq,
};

const COOKIE: &str = "archive";
const PER_ADDRESS: (usize, Duration) = (5, Duration::from_secs(15 * 60));
const OVERALL: (usize, Duration) = (20, Duration::from_secs(60 * 60));

pub struct Archive {
    passcode: String,
    token: String,
    misses: Mutex<Misses>,
}

#[derive(Default)]
struct Misses {
    by_address: HashMap<String, Vec<Instant>>,
    all: Vec<Instant>,
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
            misses: Mutex::default(),
        })
    }

    /// How many digits to ask for.
    pub fn digits(&self) -> usize {
        self.passcode.len()
    }

    fn signed_in(&self, headers: &HeaderMap) -> bool {
        cookie(headers, COOKIE)
            .is_some_and(|t| constant_time_eq(t.as_bytes(), self.token.as_bytes()))
    }

    /// Ok(true) for the right code, Ok(false) for a wrong one, Err when guessing is paused.
    fn try_code(&self, address: &str, code: &str) -> Result<bool> {
        let now = Instant::now();
        let mut m = self.misses.lock().unwrap_or_else(|e| e.into_inner());
        m.all.retain(|t| now.duration_since(*t) < OVERALL.1);
        m.by_address.retain(|_, v| {
            v.retain(|t| now.duration_since(*t) < PER_ADDRESS.1);
            !v.is_empty()
        });
        let mine = m.by_address.get(address).map_or(0, Vec::len);
        if mine >= PER_ADDRESS.0 || m.all.len() >= OVERALL.0 {
            return Err(AppError::TooManyRequests(
                "여러 번 틀려서 잠깐 잠겼어. 조금 뒤에 다시 해 줘",
            ));
        }
        if constant_time_eq(code.as_bytes(), self.passcode.as_bytes()) {
            m.by_address.remove(address);
            return Ok(true);
        }
        m.all.push(now);
        m.by_address
            .entry(address.to_owned())
            .or_default()
            .push(now);
        Ok(false)
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

/// The visitor's address: Cloudflare's header (the tunnel is the only way in), else unknown.
fn address(headers: &HeaderMap) -> String {
    headers
        .get("cf-connecting-ip")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_owned()
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

#[derive(Serialize)]
struct Stop {
    label: String,
    kind: String,
    time: String,
    /// the picked place; null while the step is still to be chosen
    name: Option<String>,
    image_url: Option<String>,
}

#[derive(Serialize)]
struct Memory {
    share_code: String,
    title: String,
    date: String,
    /// "open" | "done" (drafts stay a surprise)
    status: String,
    stops: Vec<Stop>,
}

#[derive(sqlx::FromRow)]
struct StopRow {
    course_id: String,
    label: String,
    kind: String,
    time: String,
    name: Option<String>,
    image_url: Option<String>,
}

async fn list(State(st): State<AppState>, headers: HeaderMap) -> Result<Response> {
    if !archive(&st)?.signed_in(&headers) {
        return Err(AppError::Unauthorized("생일을 먼저 입력해 줘"));
    }
    let courses = sqlx::query_as::<_, (String, String, String, String, String)>(
        "SELECT id, share_code, title, date, status FROM courses \
         WHERE deleted_at IS NULL AND status != 'draft' ORDER BY date DESC, created_at DESC",
    )
    .fetch_all(&st.db)
    .await?;
    let rows = sqlx::query_as::<_, StopRow>(
        "SELECT s.course_id, s.label, s.kind, s.time, c.name, c.image_url FROM steps s \
         JOIN courses k ON k.id = s.course_id \
         LEFT JOIN candidates c ON c.id = s.picked_id AND c.deleted_at IS NULL \
         WHERE s.deleted_at IS NULL AND k.deleted_at IS NULL AND k.status != 'draft' \
         ORDER BY s.position, s.rowid",
    )
    .fetch_all(&st.db)
    .await?;
    let mut stops: HashMap<String, Vec<Stop>> = HashMap::new();
    for r in rows {
        stops.entry(r.course_id).or_default().push(Stop {
            label: r.label,
            kind: r.kind,
            time: r.time,
            image_url: r.image_url.filter(|u| !u.is_empty()),
            name: r.name,
        });
    }
    let memories: Vec<Memory> = courses
        .into_iter()
        .map(|(id, share_code, title, date, status)| Memory {
            stops: stops.remove(&id).unwrap_or_default(),
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
}

async fn unlock(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Unlock>,
) -> Result<Response> {
    let a = archive(&st)?;
    let code: String = body.code.chars().filter(char::is_ascii_digit).collect();
    if !a.try_code(&address(&headers), &code)? {
        return Err(AppError::Forbidden("아니야. 다시 눌러 줘"));
    }
    Ok(with_cookie(&a.token, 400 * 24 * 60 * 60))
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

fn private(mut res: Response) -> Response {
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
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
    fn misses_pause_one_address_then_everyone() {
        let a = Archive::new("123456", "k").unwrap();
        for _ in 0..PER_ADDRESS.0 {
            assert!(!a.try_code("1.1.1.1", "000000").unwrap());
        }
        assert!(
            a.try_code("1.1.1.1", "123456").is_err(),
            "paused even for the right code"
        );
        assert!(
            a.try_code("2.2.2.2", "123456").unwrap(),
            "other addresses still work"
        );
        for n in 0..OVERALL.0 - PER_ADDRESS.0 {
            let _ = a.try_code(&format!("10.0.0.{n}"), "000000");
        }
        assert!(
            a.try_code("3.3.3.3", "123456").is_err(),
            "too many misses overall"
        );
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
}
