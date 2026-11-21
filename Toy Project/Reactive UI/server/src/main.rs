//! Reactive UI server: JSON API under `/api`, everything else is the built web app (SPA).

use std::{env, net::SocketAddr, path::PathBuf, str::FromStr, time::Duration};

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
use tracing_subscriber::EnvFilter;

#[derive(Clone)]
struct AppState {
    db: SqlitePool,
    /// Git revision baked into the image by deploy.sh ("dev" when run locally).
    revision: std::sync::Arc<str>,
}

/// Runtime settings, all from environment variables (defaults suit local development).
struct Config {
    bind_addr: SocketAddr,
    database_url: String,
    static_dir: PathBuf,
}

impl Config {
    fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            bind_addr: env::var("BIND_ADDR")
                .unwrap_or_else(|_| "127.0.0.1:8080".into())
                .parse()
                .context("BIND_ADDR must be host:port")?,
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite://data/app.db".into()),
            static_dir: env::var("STATIC_DIR")
                .unwrap_or_else(|_| "../web/dist".into())
                .into(),
        })
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info")),
        )
        .init();

    let config = Config::from_env()?;
    let db = open_database(&config.database_url).await?;
    let revision = env::var("APP_REVISION")
        .unwrap_or_else(|_| "dev".into())
        .into();
    let app = router(AppState { db, revision }, &config.static_dir);

    let listener = tokio::net::TcpListener::bind(config.bind_addr)
        .await
        .with_context(|| format!("bind {}", config.bind_addr))?;
    tracing::info!(addr = %config.bind_addr, static_dir = %config.static_dir.display(), "listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn open_database(url: &str) -> anyhow::Result<SqlitePool> {
    let options = SqliteConnectOptions::from_str(url)
        .with_context(|| format!("invalid DATABASE_URL: {url}"))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));

    if let Some(dir) = options
        .get_filename()
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
    {
        std::fs::create_dir_all(dir).with_context(|| format!("create {}", dir.display()))?;
    }

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .context("open database")?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .context("run migrations")?;
    Ok(pool)
}

fn router(state: AppState, static_dir: &std::path::Path) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .fallback(|| async { StatusCode::NOT_FOUND });

    // Unknown non-API paths return index.html so client-side routes survive a reload.
    let web = ServeDir::new(static_dir).fallback(ServeFile::new(static_dir.join("index.html")));

    Router::new()
        .nest("/api", api)
        .fallback_service(web)
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
    version: &'static str,
    revision: std::sync::Arc<str>,
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

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.ok();
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutting down");
}
