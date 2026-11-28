//! The day as it really went. Once a stop is decided, either of them (signed in with the
//! birthday) can mark it as changed on the day: the ticket keeps the planned place, struck
//! through, and says where they went instead, or that they skipped it. The plan itself is
//! never touched, and "원래대로" removes the change.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::HeaderMap,
    routing::put,
};
use serde::Deserialize;
use serde_json::json;

use crate::{
    AppState, archive,
    error::{AppError, Result, bad, conflict},
    model, naver,
    pick::{self, PickView},
    validate as v,
};

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/archive/courses/{code}/steps/{step}/actual",
        put(set).delete(clear),
    )
}

#[derive(Deserialize)]
struct Change {
    /// they did not go anywhere for this stop
    #[serde(default)]
    skipped: bool,
    /// where they went instead; may be left out when the map link names it
    #[serde(default)]
    name: String,
    #[serde(default)]
    memo: String,
    #[serde(default)]
    map_url: String,
}

/// The shared course and one of its decided stops: (course id, step id).
async fn decided(st: &AppState, code: &str, step: &str) -> Result<String> {
    let mut conn = st.db.acquire().await?;
    let course = model::course_by_code(&mut conn, code).await?;
    if course.status == "draft" {
        return Err(AppError::NotFound("링크를 다시 확인해 줘"));
    }
    let s = model::steps(&mut conn, &course.id)
        .await?
        .into_iter()
        .find(|s| s.id == step)
        .ok_or(AppError::NotFound("단계를 찾을 수 없어"))?;
    if s.picked_id.is_none() {
        return Err(conflict("아직 고르지 않은 단계야"));
    }
    Ok(course.id)
}

async fn view(st: &AppState, code: &str) -> Result<Json<PickView>> {
    let mut conn = st.db.acquire().await?;
    Ok(Json(pick::build(&mut conn, code).await?))
}

async fn set(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path((code, step)): Path<(String, String)>,
    Json(c): Json<Change>,
) -> Result<Json<PickView>> {
    archive::require(&st, &headers)?;
    let course_id = decided(&st, &code, &step).await?;
    let memo = v::optional_text(&c.memo, "메모", 80)?;
    let map_url = if c.skipped {
        String::new()
    } else {
        v::map_url(&c.map_url)?
    };
    // a Naver Map link brings the place's name, photo and location (a network call: before
    // the write lock)
    let place = if map_url.is_empty() {
        naver::Place::default()
    } else {
        naver::place(&map_url).await
    };
    let name = if c.skipped {
        String::new()
    } else if c.name.trim().is_empty() {
        place
            .name
            .clone()
            .map(|n| n.chars().take(30).collect())
            .ok_or_else(|| bad("대신 간 곳 이름을 적어 줘"))?
    } else {
        v::text(&c.name, "장소 이름", 30)?
    };
    let (lat, lng) = place.at.unzip();
    let mut tx = st.db.begin().await?;
    sqlx::query(
        "INSERT INTO step_actual (step_id, skipped, name, memo, map_url, image_url, lat, lng) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(step_id) DO UPDATE SET skipped = excluded.skipped, name = excluded.name, \
           memo = excluded.memo, map_url = excluded.map_url, image_url = excluded.image_url, \
           lat = excluded.lat, lng = excluded.lng, \
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
    )
    .bind(&step)
    .bind(c.skipped)
    .bind(&name)
    .bind(&memo)
    .bind(&map_url)
    .bind(place.first_photo())
    .bind(lat)
    .bind(lng)
    .execute(&mut *tx)
    .await?;
    model::touch(&mut tx, &course_id).await?;
    model::log(
        &mut tx,
        &course_id,
        // history knows two actors; the link's side, signed in with the birthday
        "picker",
        "actual.set",
        json!({ "step": step, "skipped": c.skipped, "name": name, "via": "archive" }),
    )
    .await?;
    tx.commit().await?;
    view(&st, &code).await
}

/// "원래대로": the stop went as planned after all.
async fn clear(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path((code, step)): Path<(String, String)>,
) -> Result<Json<PickView>> {
    archive::require(&st, &headers)?;
    let course_id = decided(&st, &code, &step).await?;
    let mut tx = st.db.begin().await?;
    sqlx::query("DELETE FROM step_actual WHERE step_id = ?")
        .bind(&step)
        .execute(&mut *tx)
        .await?;
    model::touch(&mut tx, &course_id).await?;
    model::log(
        &mut tx,
        &course_id,
        "picker",
        "actual.clear",
        json!({ "step": step, "via": "archive" }),
    )
    .await?;
    tx.commit().await?;
    view(&st, &code).await
}
