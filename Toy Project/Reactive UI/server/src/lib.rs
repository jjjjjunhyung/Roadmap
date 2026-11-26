//! Reactive UI server library: database, API routes, and the SPA fallback.

mod album;
pub mod archive;
pub mod backup;
pub mod error;
mod model;
mod naver;
mod pick;
mod plan;
pub mod validate;
mod weather;
mod wishes;

use std::{net::IpAddr, path::Path, str::FromStr, sync::Arc, time::Duration};

use anyhow::Context;
use axum::{
    Json, Router,
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Serialize;
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};
use tower_http::{
    compression::CompressionLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    /// Git revision baked into the image by deploy.sh ("dev" when run locally).
    pub revision: Arc<str>,
    /// Secret path segment for the planner pages; planner API is closed when unset.
    pub planner_key: Option<Arc<str>>,
    /// Client ID for Naver's map script. Public by design (it sits in the page and only works
    /// on registered domains), but kept out of the repo; the course map is hidden without it.
    pub naver_map_client_id: Option<Arc<str>>,
    /// The birthday lock on the list of every shared course; the list stays closed when unset.
    pub archive: Option<Arc<archive::Archive>>,
    /// Daily database backup to Object Storage; off when BACKUP_URL is unset.
    pub backup: Option<Arc<backup::Backup>>,
    /// Shared with CloudFront (X-Origin-Verify): requests carrying it may name the real
    /// client in CloudFront-Viewer-Address.
    pub origin_secret: Option<Arc<str>>,
    /// CloudFront's way in (origin.<domain>): only requests carrying origin_secret may use it.
    pub origin_host: Option<Arc<str>>,
}

/// Requests for the origin hostname must come from CloudFront, which adds the shared secret;
/// anyone calling it directly is turned away. Other hostnames (the public ones, should the front
/// door ever move back to Cloudflare) are not affected.
async fn only_through_cloudfront(State(st): State<AppState>, req: Request, next: Next) -> Response {
    if let (Some(host), Some(secret)) = (st.origin_host.as_deref(), st.origin_secret.as_deref()) {
        let asked = req
            .headers()
            .get(header::HOST)
            .and_then(|v| v.to_str().ok())
            .or_else(|| req.uri().host())
            .map(|h| h.split(':').next().unwrap_or(h));
        let from_cloudfront = req
            .headers()
            .get("x-origin-verify")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| plan::constant_time_eq(v.as_bytes(), secret.as_bytes()));
        if asked.is_some_and(|h| h.eq_ignore_ascii_case(host)) && !from_cloudfront {
            return (
                StatusCode::FORBIDDEN,
                [(header::CACHE_CONTROL, "no-store")],
                "Forbidden",
            )
                .into_response();
        }
    }
    next.run(req).await
}

/// The visitor's IP. Requests from CloudFront (they carry the shared secret) name it in
/// CloudFront-Viewer-Address; otherwise Cloudflare's CF-Connecting-IP. The VM is only reachable
/// through the tunnel, so neither header can come straight from a visitor.
pub(crate) fn client_ip(origin_secret: Option<&str>, headers: &HeaderMap) -> Option<IpAddr> {
    let text = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    let from_cloudfront = origin_secret.is_some_and(|secret| {
        text("x-origin-verify")
            .is_some_and(|given| plan::constant_time_eq(given.as_bytes(), secret.as_bytes()))
    });
    if from_cloudfront {
        // "203.0.113.7:46532" or "2001:db8::1:46532"
        let (ip, _port) = text("cloudfront-viewer-address")?.trim().rsplit_once(':')?;
        return ip.trim_matches(['[', ']']).parse().ok();
    }
    text("cf-connecting-ip")?.trim().parse().ok()
}

/// Build files carry a content hash in their names, so they can be kept for a year; everything
/// else outside the API (the page itself) is checked again on every visit.
async fn cache_static(req: Request, next: Next) -> Response {
    let path = req.uri().path().to_owned();
    let mut res = next.run(req).await;
    if path.starts_with("/api/") {
        return res;
    }
    let policy = if path.starts_with("/assets/") && res.status().is_success() {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(policy));
    res
}

pub async fn open_database(url: &str) -> anyhow::Result<SqlitePool> {
    let options = SqliteConnectOptions::from_str(url)
        .with_context(|| format!("invalid DATABASE_URL: {url}"))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));

    let in_memory = url.contains(":memory:");
    if !in_memory
        && let Some(dir) = options
            .get_filename()
            .parent()
            .filter(|d| !d.as_os_str().is_empty())
    {
        std::fs::create_dir_all(dir).with_context(|| format!("create {}", dir.display()))?;
    }

    let pool = SqlitePoolOptions::new()
        // an in-memory database exists per connection, so tests use exactly one
        .max_connections(if in_memory { 1 } else { 5 })
        .connect_with(options)
        .await
        .context("open database")?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .context("run migrations")?;
    Ok(pool)
}

/// API under /api; with `static_dir`, every other path serves the web app.
pub fn router(state: AppState, static_dir: Option<&Path>) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .route("/config", get(config))
        .nest("/plan", plan::router(state.clone()))
        .nest("/pick", pick::router())
        .merge(archive::router())
        .merge(album::router())
        .merge(wishes::router())
        .fallback(|| async { StatusCode::NOT_FOUND });

    let mut app = Router::new().nest("/api", api);
    if let Some(dir) = static_dir {
        // Unknown non-API paths return index.html so client-side routes survive a reload.
        // build files are served as they are (a missing one is a 404, never the page);
        // every other path is the app, so client-side routes survive a reload
        app = app
            .nest_service("/assets", ServeDir::new(dir.join("assets")))
            .fallback_service(ServeDir::new(dir).fallback(ServeFile::new(dir.join("index.html"))));
    }
    app.layer(middleware::from_fn(cache_static))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            only_through_cloudfront,
        ))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// Settings the web app needs at runtime.
#[derive(Serialize)]
struct ClientConfig {
    naver_map_client_id: Option<Arc<str>>,
    /// digits of the archive passcode; null when the archive is closed
    archive_digits: Option<usize>,
    /// Cloudflare Turnstile site key for the passcode form; null when not required
    turnstile_site_key: Option<String>,
    /// "plain" | "holiday": how the pages behind the birthday look
    theme: String,
}

async fn config(State(state): State<AppState>) -> Json<ClientConfig> {
    let theme = match state.db.acquire().await {
        Ok(mut conn) => model::theme(&mut conn)
            .await
            .unwrap_or_else(|_| "plain".into()),
        Err(_) => "plain".into(),
    };
    Json(ClientConfig {
        theme,
        naver_map_client_id: state.naver_map_client_id.clone(),
        archive_digits: state.archive.as_ref().map(|a| a.digits()),
        turnstile_site_key: state
            .archive
            .as_ref()
            .and_then(|a| a.turnstile_site_key())
            .map(Into::into),
    })
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
    version: &'static str,
    revision: Arc<str>,
    db: &'static str,
}

async fn health(State(state): State<AppState>) -> (StatusCode, Json<Health>) {
    let db_ok = sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .is_ok();
    let code = if db_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        code,
        Json(Health {
            status: if db_ok { "ok" } else { "degraded" },
            version: env!("CARGO_PKG_VERSION"),
            revision: state.revision.clone(),
            db: if db_ok { "ok" } else { "error" },
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(*k, HeaderValue::from_str(v).unwrap());
        }
        h
    }

    #[test]
    fn trusts_cloudfront_only_with_the_secret() {
        let ip = |s: &str| Some(s.parse::<IpAddr>().unwrap());
        let via_cf = headers(&[
            ("x-origin-verify", "s3cret"),
            ("cloudfront-viewer-address", "203.0.113.7:46532"),
            ("cf-connecting-ip", "198.51.100.1"),
        ]);
        assert_eq!(client_ip(Some("s3cret"), &via_cf), ip("203.0.113.7"));
        assert_eq!(
            client_ip(Some("other"), &via_cf),
            ip("198.51.100.1"),
            "wrong secret"
        );
        assert_eq!(
            client_ip(None, &via_cf),
            ip("198.51.100.1"),
            "no secret configured"
        );
        let v6 = headers(&[
            ("x-origin-verify", "s3cret"),
            ("cloudfront-viewer-address", "2001:db8::1:46532"),
        ]);
        assert_eq!(client_ip(Some("s3cret"), &v6), ip("2001:db8::1"));
        let forged = headers(&[("cloudfront-viewer-address", "192.0.2.9:1")]);
        assert_eq!(
            client_ip(Some("s3cret"), &forged),
            None,
            "no secret, no trust"
        );
    }
}
