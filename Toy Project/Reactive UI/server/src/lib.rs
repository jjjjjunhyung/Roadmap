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

use std::{path::Path, str::FromStr, sync::Arc, time::Duration};

use anyhow::Context;
use axum::{Json, Router, extract::State, http::StatusCode, routing::get};
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
        app = app
            .fallback_service(ServeDir::new(dir).fallback(ServeFile::new(dir.join("index.html"))));
    }
    app.layer(CompressionLayer::new())
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
}

async fn config(State(state): State<AppState>) -> Json<ClientConfig> {
    Json(ClientConfig {
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
