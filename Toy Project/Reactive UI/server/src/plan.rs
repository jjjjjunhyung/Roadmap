//! Planner API (/api/plan): build courses, steps and candidates.
//! Guarded by the planner key; every mutation returns the full course.

use axum::{
    Json, Router,
    extract::{Path, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::Response,
    routing::{delete, get, patch, post, put},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;

use crate::{
    AppState,
    error::{AppError, Result, bad},
    model::{self, CourseFull},
    naver, validate as v,
};

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/courses", get(list).post(create))
        .route("/courses/{id}", get(read).patch(update).delete(remove))
        .route("/courses/{id}/steps", post(add_step))
        .route("/courses/{id}/steps/order", put(order_steps))
        .route("/courses/{id}/reset", post(reset))
        .route("/courses/{id}/history", get(history))
        .route("/courses/{id}/weather", get(course_weather))
        .route("/steps/{id}", patch(update_step).delete(remove_step))
        .route("/steps/{id}/candidates", post(add_candidate))
        .route("/candidates/{id}", patch(update_candidate))
        .route("/candidates/{id}", delete(remove_candidate))
        .route("/candidates/{id}/photos", get(candidate_photos))
        .merge(crate::archive::planner_router())
        .merge(crate::backup::planner_router())
        .merge(crate::wishes::planner_router())
        .route_layer(middleware::from_fn_with_state(state, require_key))
}

/// Planner pages live behind an unguessable key (no accounts). Without a
/// configured key the planner API stays closed.
async fn require_key(
    State(st): State<AppState>,
    req: Request,
    next: Next,
) -> std::result::Result<Response, AppError> {
    let Some(expected) = st.planner_key.as_deref() else {
        return Err(AppError::Forbidden(
            "준비 화면이 설정되지 않았어 (PLANNER_KEY)".into(),
        ));
    };
    let given = req
        .headers()
        .get("x-planner-key")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if !constant_time_eq(given.as_bytes(), expected.as_bytes()) {
        return Err(AppError::Forbidden(
            "준비 화면 주소를 다시 확인해 줘".into(),
        ));
    }
    Ok(next.run(req).await)
}

pub(crate) fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

// ---------------------------------------------------------------- courses

async fn course_weather(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<crate::weather::Report>> {
    let course = {
        let mut conn = st.db.acquire().await?;
        model::course(&mut conn, &id).await?
    };
    Ok(Json(
        crate::weather::for_course(&st.db, &course.id, &course.date).await,
    ))
}

#[derive(Serialize, FromRow)]
struct CourseSummary {
    id: String,
    share_code: String,
    title: String,
    date: String,
    status: String,
    updated_at: String,
    steps: i64,
    picked: i64,
}

async fn list(State(st): State<AppState>) -> Result<Json<Vec<CourseSummary>>> {
    let rows = sqlx::query_as::<_, CourseSummary>(
        "SELECT c.id, c.share_code, c.title, c.date, c.status, c.updated_at, \
           (SELECT count(*) FROM steps s WHERE s.course_id = c.id AND s.deleted_at IS NULL) AS steps, \
           (SELECT count(*) FROM steps s WHERE s.course_id = c.id AND s.deleted_at IS NULL AND s.picked_id IS NOT NULL) AS picked \
         FROM courses c WHERE c.deleted_at IS NULL ORDER BY c.date DESC, c.created_at DESC",
    )
    .fetch_all(&st.db)
    .await?;
    Ok(Json(rows))
}

/// Default steps for a new course: lunch → cafe → activity → dinner.
const TEMPLATE: &[(&str, &str, &str, &str, &str)] = &[
    ("meal", "식당", "점심은 어디서 먹을까", "12:30", "worldcup"),
    ("cafe", "카페", "디저트는 여기서", "14:30", "roulette"),
    ("play", "활동", "오후엔 뭐 할까", "16:00", "gacha"),
    ("dinner", "저녁", "저녁은 뭐 먹을까", "18:30", "swipe"),
];

#[derive(Deserialize)]
struct NewCourse {
    title: String,
    date: String,
}

async fn create(
    State(st): State<AppState>,
    Json(body): Json<NewCourse>,
) -> Result<(StatusCode, Json<CourseFull>)> {
    let title = v::text(&body.title, "제목", 40)?;
    let date = v::date(&body.date)?;
    let mut tx = st.db.begin().await?;
    let id: String =
        sqlx::query_scalar("INSERT INTO courses (title, date) VALUES (?, ?) RETURNING id")
            .bind(&title)
            .bind(&date)
            .fetch_one(&mut *tx)
            .await?;
    for (pos, (kind, label, q, time, game)) in TEMPLATE.iter().enumerate() {
        sqlx::query("INSERT INTO steps (course_id, position, kind, label, title, time, game) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(pos as i64)
            .bind(kind)
            .bind(label)
            .bind(q)
            .bind(time)
            .bind(game)
            .execute(&mut *tx)
            .await?;
    }
    model::log(
        &mut tx,
        &id,
        "planner",
        "course.create",
        json!({ "title": title, "date": date }),
    )
    .await?;
    let full = model::full(&mut tx, &id).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(full)))
}

async fn read(State(st): State<AppState>, Path(id): Path<String>) -> Result<Json<CourseFull>> {
    let mut conn = st.db.acquire().await?;
    Ok(Json(model::full(&mut conn, &id).await?))
}

#[derive(Deserialize)]
struct CoursePatch {
    title: Option<String>,
    date: Option<String>,
    /// "draft" (hidden from the picker) or "open" (link works)
    status: Option<String>,
}

async fn update(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(p): Json<CoursePatch>,
) -> Result<Json<CourseFull>> {
    let mut tx = st.db.begin().await?;
    let cur = model::course(&mut tx, &id).await?;
    let title = match &p.title {
        Some(t) => v::text(t, "제목", 40)?,
        None => cur.title.clone(),
    };
    let date = match &p.date {
        Some(d) => v::date(d)?,
        None => cur.date.clone(),
    };
    let mut status = cur.status.clone();
    if let Some(s) = &p.status {
        match (s.as_str(), cur.status.as_str()) {
            ("draft", _) => status = "draft".into(),
            ("open", "done") => {}
            ("open", _) => {
                let full = model::full(&mut tx, &id).await?;
                if full.steps.is_empty() {
                    return Err(bad("단계를 하나 이상 만들어 줘"));
                }
                if let Some(s) = full.steps.iter().find(|s| s.candidates.len() < 2) {
                    return Err(bad(format!(
                        "'{}' 단계에 후보를 두 개 이상 넣어 줘",
                        s.step.label
                    )));
                }
                let all_picked = full.steps.iter().all(|s| s.step.picked_id.is_some());
                status = if all_picked {
                    "done".into()
                } else {
                    "open".into()
                };
            }
            _ => return Err(bad("상태 값이 올바르지 않아")),
        }
    }
    sqlx::query("UPDATE courses SET title = ?, date = ?, status = ? WHERE id = ?")
        .bind(&title)
        .bind(&date)
        .bind(&status)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    model::touch(&mut tx, &id).await?;
    model::log(
        &mut tx,
        &id,
        "planner",
        "course.update",
        json!({ "title": title, "date": date, "status": status }),
    )
    .await?;
    let full = model::full(&mut tx, &id).await?;
    tx.commit().await?;
    Ok(Json(full))
}

async fn remove(State(st): State<AppState>, Path(id): Path<String>) -> Result<StatusCode> {
    let mut tx = st.db.begin().await?;
    model::course(&mut tx, &id).await?;
    sqlx::query(
        "UPDATE courses SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
    )
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    model::log(&mut tx, &id, "planner", "course.delete", json!({})).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn reset(State(st): State<AppState>, Path(id): Path<String>) -> Result<Json<CourseFull>> {
    let mut tx = st.db.begin().await?;
    let cur = model::course(&mut tx, &id).await?;
    sqlx::query(
        "UPDATE steps SET picked_id = NULL, picked_at = NULL, rerolls_used = 0 WHERE course_id = ?",
    )
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    if cur.status == "done" {
        sqlx::query("UPDATE courses SET status = 'open' WHERE id = ?")
            .bind(&id)
            .execute(&mut *tx)
            .await?;
    }
    model::touch(&mut tx, &id).await?;
    model::log(&mut tx, &id, "planner", "course.reset", json!({})).await?;
    let full = model::full(&mut tx, &id).await?;
    tx.commit().await?;
    Ok(Json(full))
}

#[derive(Serialize, FromRow)]
struct HistoryRow {
    actor: String,
    action: String,
    detail: String,
    created_at: String,
}

async fn history(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<HistoryRow>>> {
    let mut conn = st.db.acquire().await?;
    model::course(&mut conn, &id).await?;
    let rows = sqlx::query_as::<_, HistoryRow>(
        "SELECT actor, action, detail, created_at FROM history WHERE course_id = ? ORDER BY id DESC LIMIT 100",
    )
    .bind(&id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(Json(rows))
}

// ---------------------------------------------------------------- steps

#[derive(Deserialize, Default)]
struct StepInput {
    kind: Option<String>,
    label: Option<String>,
    title: Option<String>,
    time: Option<String>,
    game: Option<String>,
    rerolls: Option<i64>,
}

struct StepValues {
    kind: String,
    label: String,
    title: String,
    time: String,
    game: String,
    rerolls: i64,
}

fn step_values(p: &StepInput, base: StepValues) -> Result<StepValues> {
    let label = match &p.label {
        Some(x) => v::text(x, "단계 이름", 12)?,
        None => base.label,
    };
    Ok(StepValues {
        kind: match &p.kind {
            Some(x) => v::one_of(x, v::KINDS, "아이콘")?,
            None => base.kind,
        },
        title: match &p.title {
            Some(x) => v::text(x, "질문", 30)?,
            None => base.title,
        },
        time: match &p.time {
            Some(x) => v::time(x)?,
            None => base.time,
        },
        game: match &p.game {
            Some(x) => v::one_of(x, v::GAMES, "게임")?,
            None => base.game,
        },
        rerolls: match p.rerolls {
            Some(x) => v::rerolls(x)?,
            None => base.rerolls,
        },
        label,
    })
}

async fn add_step(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(p): Json<StepInput>,
) -> Result<(StatusCode, Json<CourseFull>)> {
    let mut tx = st.db.begin().await?;
    model::course(&mut tx, &id).await?;
    let label = p.label.clone().unwrap_or_else(|| "새 단계".into());
    let vals = step_values(
        &p,
        StepValues {
            kind: "play".into(),
            title: format!("{} 어디로 갈까", label.trim()),
            label,
            time: String::new(),
            game: "worldcup".into(),
            rerolls: 1,
        },
    )?;
    let next: i64 = sqlx::query_scalar("SELECT coalesce(max(position), -1) + 1 FROM steps WHERE course_id = ? AND deleted_at IS NULL")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO steps (course_id, position, kind, label, title, time, game, rerolls) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(&id)
        .bind(next)
        .bind(&vals.kind)
        .bind(&vals.label)
        .bind(&vals.title)
        .bind(&vals.time)
        .bind(&vals.game)
        .bind(vals.rerolls)
        .execute(&mut *tx)
        .await?;
    model::touch(&mut tx, &id).await?;
    model::log(
        &mut tx,
        &id,
        "planner",
        "step.add",
        json!({ "label": vals.label }),
    )
    .await?;
    let full = model::full(&mut tx, &id).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(full)))
}

async fn update_step(
    State(st): State<AppState>,
    Path(step_id): Path<String>,
    Json(p): Json<StepInput>,
) -> Result<Json<CourseFull>> {
    let mut tx = st.db.begin().await?;
    let course_id = model::step_course(&mut tx, &step_id).await?;
    let cur = model::steps(&mut tx, &course_id)
        .await?
        .into_iter()
        .find(|s| s.id == step_id)
        .ok_or(AppError::NotFound("단계를 찾을 수 없어"))?;
    let vals = step_values(
        &p,
        StepValues {
            kind: cur.kind,
            label: cur.label,
            title: cur.title,
            time: cur.time,
            game: cur.game,
            rerolls: cur.rerolls,
        },
    )?;
    sqlx::query("UPDATE steps SET kind = ?, label = ?, title = ?, time = ?, game = ?, rerolls = ? WHERE id = ?")
        .bind(&vals.kind)
        .bind(&vals.label)
        .bind(&vals.title)
        .bind(&vals.time)
        .bind(&vals.game)
        .bind(vals.rerolls)
        .bind(&step_id)
        .execute(&mut *tx)
        .await?;
    model::touch(&mut tx, &course_id).await?;
    model::log(
        &mut tx,
        &course_id,
        "planner",
        "step.update",
        json!({ "step": step_id, "label": vals.label, "game": vals.game }),
    )
    .await?;
    let full = model::full(&mut tx, &course_id).await?;
    tx.commit().await?;
    Ok(Json(full))
}

async fn remove_step(
    State(st): State<AppState>,
    Path(step_id): Path<String>,
) -> Result<Json<CourseFull>> {
    let mut tx = st.db.begin().await?;
    let course_id = model::step_course(&mut tx, &step_id).await?;
    sqlx::query("UPDATE steps SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
        .bind(&step_id)
        .execute(&mut *tx)
        .await?;
    model::touch(&mut tx, &course_id).await?;
    model::log(
        &mut tx,
        &course_id,
        "planner",
        "step.delete",
        json!({ "step": step_id }),
    )
    .await?;
    let full = model::full(&mut tx, &course_id).await?;
    tx.commit().await?;
    Ok(Json(full))
}

#[derive(Deserialize)]
struct Order {
    ids: Vec<String>,
}

async fn order_steps(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(o): Json<Order>,
) -> Result<Json<CourseFull>> {
    let mut tx = st.db.begin().await?;
    let current = model::steps(&mut tx, &id).await?;
    let mut a: Vec<&str> = current.iter().map(|s| s.id.as_str()).collect();
    let mut b: Vec<&str> = o.ids.iter().map(String::as_str).collect();
    a.sort_unstable();
    b.sort_unstable();
    if a != b {
        return Err(bad("단계 순서를 다시 불러와 줘"));
    }
    for (pos, sid) in o.ids.iter().enumerate() {
        sqlx::query("UPDATE steps SET position = ? WHERE id = ?")
            .bind(pos as i64)
            .bind(sid)
            .execute(&mut *tx)
            .await?;
    }
    model::touch(&mut tx, &id).await?;
    model::log(
        &mut tx,
        &id,
        "planner",
        "step.order",
        json!({ "ids": o.ids }),
    )
    .await?;
    let full = model::full(&mut tx, &id).await?;
    tx.commit().await?;
    Ok(Json(full))
}

// ---------------------------------------------------------------- candidates

#[derive(Deserialize)]
struct CandidateInput {
    name: Option<String>,
    memo: Option<String>,
    map_url: Option<String>,
    /// Photo for the card. On add, left out or "" = fill from a Naver Map link. On update,
    /// "" = no photo; left out = keep it, or refill when the map link changes.
    image_url: Option<String>,
}

async fn add_candidate(
    State(st): State<AppState>,
    Path(step_id): Path<String>,
    Json(p): Json<CandidateInput>,
) -> Result<(StatusCode, Json<CourseFull>)> {
    let name = v::text(p.name.as_deref().unwrap_or(""), "장소 이름", 30)?;
    let memo = v::optional_text(p.memo.as_deref().unwrap_or(""), "메모", 80)?;
    let map_url = v::map_url(p.map_url.as_deref().unwrap_or(""))?;
    // the Naver lookup is a network call: do it before taking the write lock
    let place = naver::place(&map_url).await;
    let image_url = match p.image_url.as_deref().map(str::trim) {
        Some(x) if !x.is_empty() => v::image_url(x)?,
        _ => place.first_photo(),
    };
    let (lat, lng) = place.at.unzip();
    let mut tx = st.db.begin().await?;
    let course_id = model::step_course(&mut tx, &step_id).await?;
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM candidates WHERE step_id = ? AND deleted_at IS NULL",
    )
    .bind(&step_id)
    .fetch_one(&mut *tx)
    .await?;
    if count >= 8 {
        return Err(bad("후보는 한 단계에 8개까지 넣을 수 있어"));
    }
    let next: i64 = sqlx::query_scalar(
        "SELECT coalesce(max(position), -1) + 1 FROM candidates WHERE step_id = ?",
    )
    .bind(&step_id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO candidates (step_id, position, name, memo, map_url, image_url, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&step_id)
    .bind(next)
    .bind(&name)
    .bind(&memo)
    .bind(&map_url)
    .bind(&image_url)
    .bind(lat)
    .bind(lng)
    .execute(&mut *tx)
    .await?;
    model::touch(&mut tx, &course_id).await?;
    model::log(
        &mut tx,
        &course_id,
        "planner",
        "candidate.add",
        json!({ "step": step_id, "name": name }),
    )
    .await?;
    let full = model::full(&mut tx, &course_id).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(full)))
}

async fn update_candidate(
    State(st): State<AppState>,
    Path(cand_id): Path<String>,
    Json(p): Json<CandidateInput>,
) -> Result<Json<CourseFull>> {
    // Work out photo and location before the transaction: the Naver lookup is a network call.
    type Old = (String, String, Option<f64>, Option<f64>);
    let (old_map, old_image, old_lat, old_lng): Old =
        sqlx::query_as("SELECT map_url, image_url, lat, lng FROM candidates WHERE id = ?")
            .bind(&cand_id)
            .fetch_optional(&st.db)
            .await?
            .ok_or(AppError::NotFound("후보를 찾을 수 없어"))?;
    let new_map = p.map_url.as_deref().map(v::map_url).transpose()?;
    let moved = new_map.as_ref().is_some_and(|m| *m != old_map);
    // read the place for a new link, or to fill in a location it never had
    let place = match &new_map {
        Some(link) if moved || old_lat.is_none() => Some(naver::place(link).await),
        _ => None,
    };
    let image_url = match p.image_url.as_deref().map(str::trim) {
        Some("") => String::new(),
        Some(x) => v::image_url(x)?,
        // a new place: its old photo no longer fits
        None if moved => place
            .as_ref()
            .map(naver::Place::first_photo)
            .unwrap_or_default(),
        None => old_image,
    };
    let (lat, lng) = match &place {
        Some(pl) => pl.at.unzip(),
        None => (old_lat, old_lng),
    };
    let mut tx = st.db.begin().await?;
    let (course_id, _) = model::candidate_owner(&mut tx, &cand_id).await?;
    let (name, memo, map_url): (String, String, String) =
        sqlx::query_as("SELECT name, memo, map_url FROM candidates WHERE id = ?")
            .bind(&cand_id)
            .fetch_one(&mut *tx)
            .await?;
    let name = match &p.name {
        Some(x) => v::text(x, "장소 이름", 30)?,
        None => name,
    };
    let memo = match &p.memo {
        Some(x) => v::optional_text(x, "메모", 80)?,
        None => memo,
    };
    let map_url = match &p.map_url {
        Some(x) => v::map_url(x)?,
        None => map_url,
    };
    sqlx::query(
        "UPDATE candidates SET name = ?, memo = ?, map_url = ?, image_url = ?, lat = ?, lng = ? WHERE id = ?",
    )
    .bind(&name)
    .bind(&memo)
    .bind(&map_url)
    .bind(&image_url)
    .bind(lat)
    .bind(lng)
    .bind(&cand_id)
    .execute(&mut *tx)
    .await?;
    model::touch(&mut tx, &course_id).await?;
    model::log(
        &mut tx,
        &course_id,
        "planner",
        "candidate.update",
        json!({ "candidate": cand_id, "name": name }),
    )
    .await?;
    let full = model::full(&mut tx, &course_id).await?;
    tx.commit().await?;
    Ok(Json(full))
}

/// Photos the planner can choose from, read from the candidate's Naver Map link.
async fn candidate_photos(
    State(st): State<AppState>,
    Path(cand_id): Path<String>,
) -> Result<Json<Vec<naver::Photo>>> {
    let map_url = {
        let mut conn = st.db.acquire().await?;
        model::candidate_owner(&mut conn, &cand_id).await?;
        sqlx::query_scalar::<_, String>("SELECT map_url FROM candidates WHERE id = ?")
            .bind(&cand_id)
            .fetch_one(&mut *conn)
            .await?
    };
    Ok(Json(naver::place(&map_url).await.photos))
}

async fn remove_candidate(
    State(st): State<AppState>,
    Path(cand_id): Path<String>,
) -> Result<Json<CourseFull>> {
    let mut tx = st.db.begin().await?;
    let (course_id, step_id) = model::candidate_owner(&mut tx, &cand_id).await?;
    sqlx::query(
        "UPDATE candidates SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
    )
    .bind(&cand_id)
    .execute(&mut *tx)
    .await?;
    // A removed candidate can no longer be the answer.
    sqlx::query(
        "UPDATE steps SET picked_id = NULL, picked_at = NULL WHERE id = ? AND picked_id = ?",
    )
    .bind(&step_id)
    .bind(&cand_id)
    .execute(&mut *tx)
    .await?;
    model::touch(&mut tx, &course_id).await?;
    model::log(
        &mut tx,
        &course_id,
        "planner",
        "candidate.delete",
        json!({ "candidate": cand_id }),
    )
    .await?;
    let full = model::full(&mut tx, &course_id).await?;
    tx.commit().await?;
    Ok(Json(full))
}
