//! Archive (/api/archive): every course that has been shared, for people signed in with a
//! passkey (see `auth`). Drafts stay a surprise.

use axum::{
    Json, Router,
    extract::State,
    http::HeaderMap,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Serialize;

use crate::{AppState, auth, error::Result};

pub fn router() -> Router<AppState> {
    Router::new().route("/archive", get(list))
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
    auth::person(&st, &headers).await?;
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
    let mut stops: std::collections::HashMap<String, Vec<Stop>> = Default::default();
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
    Ok(auth::private(Json(memories).into_response()))
}
