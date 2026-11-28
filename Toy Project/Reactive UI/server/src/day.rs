//! The day as it really went. Once a stop is decided, either of them (signed in with the
//! birthday) can mark it as changed on the day: the ticket keeps the planned place, struck
//! through, and says where they went instead, or that they skipped it. The plan itself is
//! never touched, and "원래대로" removes the change. Places they dropped by that were never in
//! the plan are added as extra stops, each after one of the course's stops.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::HeaderMap,
    routing::{post, put},
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
    Router::new()
        .route(
            "/archive/courses/{code}/steps/{step}/actual",
            put(set).delete(clear),
        )
        .route("/archive/courses/{code}/extras", post(add_extra))
        .route(
            "/archive/courses/{code}/extras/{id}",
            put(edit_extra).delete(remove_extra),
        )
}

/// Extra stops a course may gather on one day.
const MAX_EXTRAS: i64 = 12;

#[derive(Deserialize)]
struct ExtraInput {
    /// the stop it came after; null for the end of the day
    #[serde(default)]
    after_step_id: Option<String>,
    #[serde(default)]
    time: String,
    #[serde(default)]
    kind: String,
    /// may be left out when the map link names the place
    #[serde(default)]
    name: String,
    #[serde(default)]
    memo: String,
    #[serde(default)]
    map_url: String,
}

/// A checked extra stop, its place read from the map link.
struct ExtraValues {
    after: Option<String>,
    time: String,
    kind: String,
    name: String,
    memo: String,
    map_url: String,
    place: naver::Place,
}

/// The shared course (not a draft) by its code: its id.
async fn shared(st: &AppState, code: &str) -> Result<String> {
    let mut conn = st.db.acquire().await?;
    let course = model::course_by_code(&mut conn, code).await?;
    if course.status == "draft" {
        return Err(AppError::NotFound("링크를 다시 확인해 줘"));
    }
    Ok(course.id)
}

async fn extra_values(st: &AppState, course_id: &str, x: ExtraInput) -> Result<ExtraValues> {
    let after = x.after_step_id.filter(|s| !s.is_empty());
    if let Some(step) = &after {
        let mut conn = st.db.acquire().await?;
        if model::step_course(&mut conn, step).await.ok().as_deref() != Some(course_id) {
            return Err(bad("이 데이트의 단계가 아니야"));
        }
    }
    let kind = if x.kind.is_empty() {
        "play".to_string()
    } else {
        v::one_of(&x.kind, v::KINDS, "아이콘")?
    };
    let map_url = v::map_url(&x.map_url)?;
    // the place behind a Naver Map link: name, photo and location (a network call, so before
    // any write)
    let place = if map_url.is_empty() {
        naver::Place::default()
    } else {
        naver::place(&map_url).await
    };
    let name = if x.name.trim().is_empty() {
        place
            .name
            .clone()
            .map(|n| n.chars().take(30).collect())
            .ok_or_else(|| bad("들른 곳 이름을 적어 줘"))?
    } else {
        v::text(&x.name, "장소 이름", 30)?
    };
    Ok(ExtraValues {
        after,
        time: v::time(&x.time)?,
        kind,
        name,
        memo: v::optional_text(&x.memo, "메모", 80)?,
        map_url,
        place,
    })
}

async fn add_extra(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(code): Path<String>,
    Json(x): Json<ExtraInput>,
) -> Result<Json<PickView>> {
    archive::require(&st, &headers)?;
    let course_id = shared(&st, &code).await?;
    let e = extra_values(&st, &course_id, x).await?;
    let mut tx = st.db.begin().await?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM extra_stops WHERE course_id = ?")
        .bind(&course_id)
        .fetch_one(&mut *tx)
        .await?;
    if count >= MAX_EXTRAS {
        return Err(bad(format!("들른 곳은 {MAX_EXTRAS}곳까지 더할 수 있어")));
    }
    let (lat, lng) = e.place.at.unzip();
    sqlx::query(
        "INSERT INTO extra_stops (course_id, after_step_id, time, kind, name, memo, map_url, \
         image_url, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&course_id)
    .bind(&e.after)
    .bind(&e.time)
    .bind(&e.kind)
    .bind(&e.name)
    .bind(&e.memo)
    .bind(&e.map_url)
    .bind(e.place.first_photo())
    .bind(lat)
    .bind(lng)
    .execute(&mut *tx)
    .await?;
    model::touch(&mut tx, &course_id).await?;
    model::log(
        &mut tx,
        &course_id,
        "picker",
        "extra.add",
        json!({ "name": e.name, "after": e.after, "via": "archive" }),
    )
    .await?;
    tx.commit().await?;
    view(&st, &code).await
}

async fn edit_extra(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path((code, id)): Path<(String, String)>,
    Json(x): Json<ExtraInput>,
) -> Result<Json<PickView>> {
    archive::require(&st, &headers)?;
    let course_id = shared(&st, &code).await?;
    let e = extra_values(&st, &course_id, x).await?;
    let (lat, lng) = e.place.at.unzip();
    let mut tx = st.db.begin().await?;
    let done = sqlx::query(
        "UPDATE extra_stops SET after_step_id = ?, time = ?, kind = ?, name = ?, memo = ?, \
         map_url = ?, image_url = ?, lat = ?, lng = ? WHERE id = ? AND course_id = ?",
    )
    .bind(&e.after)
    .bind(&e.time)
    .bind(&e.kind)
    .bind(&e.name)
    .bind(&e.memo)
    .bind(&e.map_url)
    .bind(e.place.first_photo())
    .bind(lat)
    .bind(lng)
    .bind(&id)
    .bind(&course_id)
    .execute(&mut *tx)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound("들른 곳을 찾을 수 없어"));
    }
    model::touch(&mut tx, &course_id).await?;
    model::log(
        &mut tx,
        &course_id,
        "picker",
        "extra.update",
        json!({ "extra": id, "name": e.name, "via": "archive" }),
    )
    .await?;
    tx.commit().await?;
    view(&st, &code).await
}

async fn remove_extra(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path((code, id)): Path<(String, String)>,
) -> Result<Json<PickView>> {
    archive::require(&st, &headers)?;
    let course_id = shared(&st, &code).await?;
    let mut tx = st.db.begin().await?;
    let done = sqlx::query("DELETE FROM extra_stops WHERE id = ? AND course_id = ?")
        .bind(&id)
        .bind(&course_id)
        .execute(&mut *tx)
        .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound("들른 곳을 찾을 수 없어"));
    }
    model::touch(&mut tx, &course_id).await?;
    model::log(
        &mut tx,
        &course_id,
        "picker",
        "extra.delete",
        json!({ "extra": id, "via": "archive" }),
    )
    .await?;
    tx.commit().await?;
    view(&st, &code).await
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
