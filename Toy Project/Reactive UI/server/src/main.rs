//! Reactive UI server: JSON API under `/api`, everything else is the built web app (SPA).

use std::{env, net::SocketAddr, path::PathBuf};

use anyhow::Context;
use reactive_ui_server::{AppState, auth::Auth, open_database, router};
use tracing_subscriber::EnvFilter;

/// Runtime settings, all from environment variables (defaults suit local development).
struct Config {
    bind_addr: SocketAddr,
    database_url: String,
    static_dir: PathBuf,
    planner_key: Option<String>,
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
            planner_key: env::var("PLANNER_KEY").ok().filter(|k| k.len() >= 3),
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
    if config.planner_key.is_none() {
        tracing::warn!("PLANNER_KEY is not set: the planner API is closed");
    }
    // the public origin (e.g. https://example.com) the passkeys are bound to
    let auth = match env::var("PUBLIC_ORIGIN")
        .ok()
        .filter(|v| !v.trim().is_empty())
    {
        Some(origin) => Some(Auth::new(&origin).context("PUBLIC_ORIGIN")?.into()),
        None => {
            tracing::warn!("PUBLIC_ORIGIN is not set: passkey sign-in and the archive are closed");
            None
        }
    };
    let state = AppState {
        db: open_database(&config.database_url).await?,
        revision: env::var("APP_REVISION")
            .unwrap_or_else(|_| "dev".into())
            .into(),
        planner_key: config.planner_key.map(Into::into),
        naver_map_client_id: env::var("NAVER_MAP_CLIENT_ID")
            .ok()
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty())
            .map(Into::into),
        auth,
    };
    let app = router(state, Some(&config.static_dir));

    let listener = tokio::net::TcpListener::bind(config.bind_addr)
        .await
        .with_context(|| format!("bind {}", config.bind_addr))?;
    tracing::info!(addr = %config.bind_addr, static_dir = %config.static_dir.display(), "listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
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
