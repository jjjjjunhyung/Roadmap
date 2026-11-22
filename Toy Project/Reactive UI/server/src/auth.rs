//! Passkeys (WebAuthn) for the people who may open the archive (and, later, the album).
//!
//! No passwords and no accounts to sign up for: the planner makes a single-use link (24 hours)
//! for a person, and opening it registers that device's passkey (Face ID, fingerprint, the
//! device's screen lock). From then on the device signs in with one tap; other computers can sign
//! in through the browser's "use another device" QR code. Where passkeys cannot work (in-app
//! browsers), the same link can instead open a short session once.
//!
//! Sessions are random tokens in an HttpOnly cookie; only their SHA-256 is stored, as with the
//! link tokens, so a copy of the database opens nothing.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use webauthn_rs::prelude::{
    CreationChallengeResponse, Passkey, PasskeyAuthentication, PasskeyRegistration,
    PublicKeyCredential, RegisterPublicKeyCredential, RequestChallengeResponse, Url, Uuid,
    Webauthn, WebauthnBuilder,
};

use crate::{
    AppState,
    error::{AppError, Result, bad, conflict},
};

const COOKIE: &str = "session";
const DAY: i64 = 24 * 60 * 60;
/// A passkey session lasts this long after its last use.
const PASSKEY_SESSION: i64 = 30 * DAY;
/// A session opened by a link alone (no passkey) does not stretch.
const LINK_SESSION: i64 = 7 * DAY;
const INVITE_LIFE: i64 = DAY;
/// A ceremony (Face ID prompt) must finish within this.
const FLOW_LIFE: Duration = Duration::from_secs(5 * 60);
const MAX_FLOWS: usize = 500;

pub struct Auth {
    webauthn: Webauthn,
    /// Registration and sign-in ceremonies in progress, by flow id. Kept in memory: a restart
    /// only means pressing the button again.
    flows: Mutex<HashMap<String, (Instant, Flow)>>,
}

enum Flow {
    Register {
        invite: String,
        person: String,
        state: PasskeyRegistration,
    },
    SignIn(PasskeyAuthentication),
}

impl Auth {
    /// `origin` is the site's public origin, e.g. "https://example.com" or "http://localhost:8080".
    pub fn new(origin: &str) -> anyhow::Result<Self> {
        let url = Url::parse(origin.trim())?;
        let rp_id = url
            .host_str()
            .ok_or_else(|| anyhow::anyhow!("origin has no host"))?
            .to_owned();
        let webauthn = WebauthnBuilder::new(&rp_id, &url)?
            .rp_name("Date Course")
            .allow_any_port(rp_id == "localhost")
            .build()?;
        Ok(Self {
            webauthn,
            flows: Mutex::default(),
        })
    }

    fn put(&self, flow: Flow) -> String {
        let id = token();
        let mut flows = self.flows.lock().unwrap_or_else(|e| e.into_inner());
        flows.retain(|_, (at, _)| at.elapsed() < FLOW_LIFE);
        if flows.len() >= MAX_FLOWS {
            // under a flood, the oldest ceremonies go first
            if let Some(oldest) = flows
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(k, _)| k.clone())
            {
                flows.remove(&oldest);
            }
        }
        flows.insert(id.clone(), (Instant::now(), flow));
        id
    }

    fn take(&self, id: &str) -> Option<Flow> {
        let mut flows = self.flows.lock().unwrap_or_else(|e| e.into_inner());
        flows
            .remove(id)
            .filter(|(at, _)| at.elapsed() < FLOW_LIFE)
            .map(|(_, f)| f)
    }
}

// ------------------------------------------------------------------ helpers

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 256 random bits as hex: link tokens, session tokens and flow ids.
fn token() -> String {
    let mut buf = [0u8; 32];
    getrandom::fill(&mut buf).expect("the OS random source failed");
    hex(&buf)
}

fn digest(token: &str) -> String {
    hex(&Sha256::digest(token.as_bytes()))
}

fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|kv| kv.trim().strip_prefix(name)?.strip_prefix('='))
}

fn agent(headers: &HeaderMap) -> String {
    headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .chars()
        .take(300)
        .collect()
}

fn with_cookie(mut res: Response, value: &str, max_age: i64) -> Response {
    let c = format!(
        "{COOKIE}={value}; Path=/api; Max-Age={max_age}; HttpOnly; Secure; SameSite=Strict"
    );
    if let Ok(v) = HeaderValue::from_str(&c) {
        res.headers_mut().insert(header::SET_COOKIE, v);
    }
    private(res)
}

pub fn private(mut res: Response) -> Response {
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

fn auth(st: &AppState) -> Result<&Auth> {
    st.auth
        .as_deref()
        .ok_or(AppError::NotFound("아직 열리지 않았어"))
}

/// Who is signed in, for routes behind a session.
#[derive(Debug, Clone, Serialize)]
pub struct Person {
    pub id: String,
    pub name: String,
}

/// The signed-in person, or 401. Passkey sessions stretch by use.
pub async fn person(st: &AppState, headers: &HeaderMap) -> Result<Person> {
    auth(st)?;
    let Some(t) = cookie(headers, COOKIE).filter(|t| !t.is_empty()) else {
        return Err(AppError::Unauthorized("먼저 들어와 줘"));
    };
    let now = now();
    let found = sqlx::query_as::<_, (String, String, String, Option<String>, i64)>(
        "SELECT s.id, p.id, p.name, s.passkey_id, s.expires_at FROM sessions s \
         JOIN people p ON p.id = s.person_id WHERE s.id = ? AND s.expires_at > ?",
    )
    .bind(digest(t))
    .bind(now)
    .fetch_optional(&st.db)
    .await?;
    let Some((sid, id, name, passkey, expires)) = found else {
        return Err(AppError::Unauthorized("다시 들어와 줘"));
    };
    if passkey.is_some() && expires - now < PASSKEY_SESSION - DAY {
        sqlx::query("UPDATE sessions SET expires_at = ?, seen_at = ? WHERE id = ?")
            .bind(now + PASSKEY_SESSION)
            .bind(now)
            .bind(&sid)
            .execute(&st.db)
            .await?;
    }
    Ok(Person { id, name })
}

/// A new session for `person`, set as the cookie on `res`.
async fn open_session(
    st: &AppState,
    person: &str,
    passkey: Option<&str>,
    headers: &HeaderMap,
    res: Response,
) -> Result<Response> {
    let t = token();
    let now = now();
    let life = if passkey.is_some() {
        PASSKEY_SESSION
    } else {
        LINK_SESSION
    };
    sqlx::query(
        "INSERT INTO sessions (id, person_id, passkey_id, agent, created_at, seen_at, expires_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(digest(&t))
    .bind(person)
    .bind(passkey)
    .bind(agent(headers))
    .bind(now)
    .bind(now)
    .bind(now + life)
    .execute(&st.db)
    .await?;
    sqlx::query("DELETE FROM sessions WHERE expires_at < ?")
        .bind(now)
        .execute(&st.db)
        .await?;
    // the cookie outlives the session; the server decides when it ends
    Ok(with_cookie(res, &t, 400 * DAY))
}

/// A link that is still good: (token digest, person id, person name).
async fn live_invite(st: &AppState, token: &str) -> Result<(String, String, String)> {
    sqlx::query_as::<_, (String, String, String)>(
        "SELECT i.id, p.id, p.name FROM invites i JOIN people p ON p.id = i.person_id \
         WHERE i.id = ? AND i.used_at IS NULL AND i.expires_at > ?",
    )
    .bind(digest(token))
    .bind(now())
    .fetch_optional(&st.db)
    .await?
    .ok_or(AppError::NotFound(
        "이미 쓴 링크이거나 시간이 지났어. 새 링크를 받아 줘",
    ))
}

/// Marks a link used; false when someone else got there first.
async fn spend_invite(st: &AppState, invite: &str) -> Result<bool> {
    let done = sqlx::query(
        "UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?",
    )
    .bind(now())
    .bind(invite)
    .bind(now())
    .execute(&st.db)
    .await?;
    Ok(done.rows_affected() == 1)
}

fn credential_id(p: &Passkey) -> String {
    hex(p.cred_id().as_ref())
}

async fn passkeys_of(st: &AppState, person: Option<&str>) -> Result<Vec<(String, Passkey)>> {
    let rows = sqlx::query_as::<_, (String, String)>(
        "SELECT id, passkey FROM passkeys WHERE (?1 IS NULL OR person_id = ?1)",
    )
    .bind(person)
    .fetch_all(&st.db)
    .await?;
    Ok(rows
        .into_iter()
        .filter_map(|(id, json)| serde_json::from_str(&json).ok().map(|p| (id, p)))
        .collect())
}

// ------------------------------------------------------------------ public routes

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/me", get(me))
        .route("/auth/invite/{token}", get(invite))
        .route("/auth/invite/{token}/register", post(register_start))
        .route("/auth/invite/{token}/enter", post(enter))
        .route("/auth/register", post(register_finish))
        .route("/auth/signin/start", post(signin_start))
        .route("/auth/signin", post(signin_finish))
        .route("/auth/logout", post(logout))
}

async fn me(State(st): State<AppState>, headers: HeaderMap) -> Result<Response> {
    let p = person(&st, &headers).await?;
    Ok(private(Json(p).into_response()))
}

#[derive(Serialize)]
struct InviteView {
    name: String,
    expires_at: i64,
}

async fn invite(State(st): State<AppState>, Path(token): Path<String>) -> Result<Json<InviteView>> {
    auth(&st)?;
    let (id, _, name) = live_invite(&st, &token).await?;
    let expires_at = sqlx::query_scalar("SELECT expires_at FROM invites WHERE id = ?")
        .bind(&id)
        .fetch_one(&st.db)
        .await?;
    Ok(Json(InviteView { name, expires_at }))
}

#[derive(Serialize)]
struct Started<T> {
    flow: String,
    options: T,
}

async fn register_start(
    State(st): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<Started<CreationChallengeResponse>>> {
    let a = auth(&st)?;
    let (invite, person, name) = live_invite(&st, &token).await?;
    let uuid = Uuid::parse_str(&person).map_err(|e| AppError::Internal(e.into()))?;
    let exclude = passkeys_of(&st, Some(&person))
        .await?
        .iter()
        .map(|(_, p)| p.cred_id().clone())
        .collect::<Vec<_>>();
    let (options, state) = a
        .webauthn
        .start_passkey_registration(uuid, &name, &name, Some(exclude))
        .map_err(|e| AppError::Internal(e.into()))?;
    let flow = a.put(Flow::Register {
        invite,
        person,
        state,
    });
    Ok(Json(Started { flow, options }))
}

#[derive(Deserialize)]
struct Finish<T> {
    flow: String,
    credential: T,
}

async fn register_finish(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Finish<RegisterPublicKeyCredential>>,
) -> Result<Response> {
    let a = auth(&st)?;
    let Some(Flow::Register {
        invite,
        person,
        state,
    }) = a.take(&body.flow)
    else {
        return Err(conflict("시간이 지났어. 다시 눌러 줘"));
    };
    let passkey = a
        .webauthn
        .finish_passkey_registration(&body.credential, &state)
        .map_err(|e| {
            tracing::warn!("passkey registration rejected: {e:?}");
            bad("등록을 확인하지 못했어. 다시 해 줘")
        })?;
    let id = credential_id(&passkey);
    let taken: bool = sqlx::query_scalar("SELECT count(*) > 0 FROM passkeys WHERE id = ?")
        .bind(&id)
        .fetch_one(&st.db)
        .await?;
    if taken {
        return Err(conflict(
            "이 기기는 이미 등록돼 있어. 처음 화면에서 들어가 줘",
        ));
    }
    if !spend_invite(&st, &invite).await? {
        return Err(AppError::NotFound(
            "이미 쓴 링크이거나 시간이 지났어. 새 링크를 받아 줘",
        ));
    }
    let now = now();
    sqlx::query(
        "INSERT INTO passkeys (id, person_id, passkey, agent, created_at, used_at) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&person)
    .bind(serde_json::to_string(&passkey).map_err(|e| AppError::Internal(e.into()))?)
    .bind(agent(&headers))
    .bind(now)
    .bind(now)
    .execute(&st.db)
    .await?;
    open_session(
        &st,
        &person,
        Some(&id),
        &headers,
        StatusCode::NO_CONTENT.into_response(),
    )
    .await
}

/// The link alone, for browsers that cannot hold a passkey: one short session, link spent.
async fn enter(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<Response> {
    auth(&st)?;
    let (invite, person, _) = live_invite(&st, &token).await?;
    if !spend_invite(&st, &invite).await? {
        return Err(AppError::NotFound(
            "이미 쓴 링크이거나 시간이 지났어. 새 링크를 받아 줘",
        ));
    }
    open_session(
        &st,
        &person,
        None,
        &headers,
        StatusCode::NO_CONTENT.into_response(),
    )
    .await
}

async fn signin_start(
    State(st): State<AppState>,
) -> Result<Json<Started<RequestChallengeResponse>>> {
    let a = auth(&st)?;
    let keys: Vec<Passkey> = passkeys_of(&st, None)
        .await?
        .into_iter()
        .map(|(_, p)| p)
        .collect();
    if keys.is_empty() {
        return Err(conflict(
            "아직 등록된 기기가 없어. 받은 등록 링크로 먼저 들어와 줘",
        ));
    }
    let (options, state) = a
        .webauthn
        .start_passkey_authentication(&keys)
        .map_err(|e| AppError::Internal(e.into()))?;
    let flow = a.put(Flow::SignIn(state));
    Ok(Json(Started { flow, options }))
}

async fn signin_finish(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Finish<PublicKeyCredential>>,
) -> Result<Response> {
    let a = auth(&st)?;
    let Some(Flow::SignIn(state)) = a.take(&body.flow) else {
        return Err(conflict("시간이 지났어. 다시 눌러 줘"));
    };
    let result = a
        .webauthn
        .finish_passkey_authentication(&body.credential, &state)
        .map_err(|e| {
            tracing::warn!("passkey sign-in rejected: {e:?}");
            AppError::Unauthorized("확인하지 못했어. 다시 해 줘")
        })?;
    let id = hex(result.cred_id().as_ref());
    let row = sqlx::query_as::<_, (String, String)>(
        "SELECT person_id, passkey FROM passkeys WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&st.db)
    .await?
    .ok_or(AppError::Unauthorized(
        "등록이 지워진 기기야. 새 링크를 받아 줘",
    ))?;
    let (person, json) = row;
    if let Ok(mut passkey) = serde_json::from_str::<Passkey>(&json)
        && passkey.update_credential(&result) == Some(true)
        && let Ok(json) = serde_json::to_string(&passkey)
    {
        sqlx::query("UPDATE passkeys SET passkey = ? WHERE id = ?")
            .bind(json)
            .bind(&id)
            .execute(&st.db)
            .await?;
    }
    sqlx::query("UPDATE passkeys SET used_at = ? WHERE id = ?")
        .bind(now())
        .bind(&id)
        .execute(&st.db)
        .await?;
    open_session(
        &st,
        &person,
        Some(&id),
        &headers,
        StatusCode::NO_CONTENT.into_response(),
    )
    .await
}

async fn logout(State(st): State<AppState>, headers: HeaderMap) -> Result<Response> {
    if let Some(t) = cookie(&headers, COOKIE) {
        sqlx::query("DELETE FROM sessions WHERE id = ?")
            .bind(digest(t))
            .execute(&st.db)
            .await?;
    }
    Ok(with_cookie(StatusCode::NO_CONTENT.into_response(), "", 0))
}

// ------------------------------------------------------------------ planner routes

/// For the planner API (behind its key): people, their devices, links and sessions.
pub fn planner_router() -> Router<AppState> {
    Router::new()
        .route("/people", get(people))
        .route("/invites", post(new_invite))
        .route("/passkeys/{id}", delete(remove_passkey))
        .route("/people/{id}/sessions", delete(end_sessions))
        .route("/people/{id}", delete(remove_person))
}

#[derive(Serialize)]
struct DeviceView {
    id: String,
    agent: String,
    created_at: i64,
    used_at: i64,
}

#[derive(Serialize)]
struct PersonView {
    id: String,
    name: String,
    devices: Vec<DeviceView>,
    /// sessions still open (passkey or link)
    sessions: i64,
    /// links not used yet and not expired
    open_invites: i64,
}

async fn people_view(st: &AppState) -> Result<Vec<PersonView>> {
    let now = now();
    let people = sqlx::query_as::<_, (String, String, i64, i64)>(
        "SELECT p.id, p.name, \
           (SELECT count(*) FROM sessions s WHERE s.person_id = p.id AND s.expires_at > ?1), \
           (SELECT count(*) FROM invites i WHERE i.person_id = p.id AND i.used_at IS NULL AND i.expires_at > ?1) \
         FROM people p ORDER BY p.created_at",
    )
    .bind(now)
    .fetch_all(&st.db)
    .await?;
    let devices = sqlx::query_as::<_, (String, String, String, i64, i64)>(
        "SELECT person_id, id, agent, created_at, used_at FROM passkeys ORDER BY created_at",
    )
    .fetch_all(&st.db)
    .await?;
    Ok(people
        .into_iter()
        .map(|(id, name, sessions, open_invites)| PersonView {
            devices: devices
                .iter()
                .filter(|d| d.0 == id)
                .map(|(_, did, agent, created_at, used_at)| DeviceView {
                    id: did.clone(),
                    agent: agent.clone(),
                    created_at: *created_at,
                    used_at: *used_at,
                })
                .collect(),
            id,
            name,
            sessions,
            open_invites,
        })
        .collect())
}

async fn people(State(st): State<AppState>) -> Result<Json<Vec<PersonView>>> {
    auth(&st)?;
    Ok(Json(people_view(&st).await?))
}

#[derive(Deserialize)]
struct NewInvite {
    name: String,
}

#[derive(Serialize)]
struct InviteMade {
    /// shown once: the link is /join/<token>
    token: String,
    expires_at: i64,
    people: Vec<PersonView>,
}

/// A single-use link for `name` (a new person, or more devices for an existing one).
async fn new_invite(
    State(st): State<AppState>,
    Json(body): Json<NewInvite>,
) -> Result<Json<InviteMade>> {
    auth(&st)?;
    let name = crate::validate::text(&body.name, "이름", 20)?;
    let now = now();
    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM people WHERE name = ?")
        .bind(&name)
        .fetch_optional(&st.db)
        .await?;
    let person = match existing {
        Some(id) => id,
        None => {
            let id = Uuid::new_v4().to_string();
            sqlx::query("INSERT INTO people (id, name, created_at) VALUES (?, ?, ?)")
                .bind(&id)
                .bind(&name)
                .bind(now)
                .execute(&st.db)
                .await?;
            id
        }
    };
    let t = token();
    sqlx::query("INSERT INTO invites (id, person_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
        .bind(digest(&t))
        .bind(&person)
        .bind(now)
        .bind(now + INVITE_LIFE)
        .execute(&st.db)
        .await?;
    sqlx::query("DELETE FROM invites WHERE expires_at < ?")
        .bind(now - 30 * DAY)
        .execute(&st.db)
        .await?;
    Ok(Json(InviteMade {
        token: t,
        expires_at: now + INVITE_LIFE,
        people: people_view(&st).await?,
    }))
}

/// Forgets a device: its passkey and the sessions it opened.
async fn remove_passkey(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<PersonView>>> {
    auth(&st)?;
    sqlx::query("DELETE FROM sessions WHERE passkey_id = ?")
        .bind(&id)
        .execute(&st.db)
        .await?;
    sqlx::query("DELETE FROM passkeys WHERE id = ?")
        .bind(&id)
        .execute(&st.db)
        .await?;
    Ok(Json(people_view(&st).await?))
}

/// Signs a person out everywhere (devices stay registered).
async fn end_sessions(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<PersonView>>> {
    auth(&st)?;
    sqlx::query("DELETE FROM sessions WHERE person_id = ?")
        .bind(&id)
        .execute(&st.db)
        .await?;
    Ok(Json(people_view(&st).await?))
}

/// Removes a person with their devices, links and sessions.
async fn remove_person(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<PersonView>>> {
    auth(&st)?;
    let mut tx = st.db.begin().await?;
    for sql in [
        "DELETE FROM sessions WHERE person_id = ?",
        "DELETE FROM passkeys WHERE person_id = ?",
        "DELETE FROM invites WHERE person_id = ?",
        "DELETE FROM people WHERE id = ?",
    ] {
        sqlx::query(sql).bind(&id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(people_view(&st).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_random_and_stored_hashed() {
        let (a, b) = (token(), token());
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
        assert_ne!(digest(&a), a);
        assert_eq!(digest(&a), digest(&a));
    }

    #[test]
    fn origins() {
        assert!(Auth::new("https://example.com").is_ok());
        assert!(Auth::new("http://localhost:8080").is_ok());
        assert!(Auth::new("not a url").is_err());
    }

    #[test]
    fn flows_are_single_use() {
        let a = Auth::new("http://localhost:8080").unwrap();
        let (_, state) = a
            .webauthn
            .start_passkey_registration(Uuid::new_v4(), "n", "n", None)
            .unwrap();
        let id = a.put(Flow::Register {
            invite: "i".into(),
            person: "p".into(),
            state,
        });
        assert!(a.take(&id).is_some());
        assert!(a.take(&id).is_none(), "a flow can be finished once");
        assert!(a.take("unknown").is_none());
    }

    #[test]
    fn reads_the_cookie() {
        let mut h = HeaderMap::new();
        h.insert(header::COOKIE, HeaderValue::from_static("a=1; session=xyz"));
        assert_eq!(cookie(&h, "session"), Some("xyz"));
        assert_eq!(cookie(&h, "sess"), None);
    }
}
