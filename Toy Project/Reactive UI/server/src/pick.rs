//! Picker API (/api/pick/{code}): the shared link. The whole day is shown up front: steps the
//! planner fixed (a single candidate) with their place, and the steps still to choose, which the
//! picker plays in any order she likes.

use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::SqliteConnection;

use crate::{
    AppState,
    error::{AppError, Result, conflict},
    model::{self, Candidate},
    validate,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/{code}", get(view))
        .route("/{code}/steps/{step}/pick", post(pick))
        .route("/{code}/steps/{step}/reroll", post(reroll))
        .route("/{code}/weather", get(weather))
}

/// The weather on the course's day (drafts too: it gives nothing of the course away).
async fn weather(
    State(st): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<crate::weather::Report>> {
    let course = {
        let mut conn = st.db.acquire().await?;
        model::course_by_code(&mut conn, &code).await?
    };
    Ok(Json(
        crate::weather::for_course(&st.db, &course.id, &course.date).await,
    ))
}

#[derive(Serialize)]
pub struct Place {
    id: String,
    name: String,
    memo: String,
    map_url: String,
    image_url: String,
    lat: Option<f64>,
    lng: Option<f64>,
}

impl From<&Candidate> for Place {
    fn from(c: &Candidate) -> Self {
        Place {
            id: c.id.clone(),
            name: c.name.clone(),
            memo: c.memo.clone(),
            map_url: c.map_url.clone(),
            image_url: c.image_url.clone(),
            lat: c.lat,
            lng: c.lng,
        }
    }
}

#[derive(Serialize)]
pub struct StepSummary {
    id: String,
    kind: String,
    label: String,
    time: String,
    /// "fixed" (the planner decided) | "done" (chosen in a game) | "open" (still to choose)
    state: &'static str,
    picked: Option<Place>,
}

#[derive(Serialize)]
pub struct OpenStep {
    id: String,
    kind: String,
    label: String,
    title: String,
    time: String,
    game: String,
    rerolls_left: i64,
    candidates: Vec<Place>,
}

#[derive(Serialize)]
pub struct PickView {
    title: String,
    date: String,
    /// "draft" (not shared yet) | "open" | "done"
    status: String,
    /// "plain" | "holiday"
    theme: String,
    steps: Vec<StepSummary>,
    /// the steps still to choose, with their games and candidates, in course order
    open: Vec<OpenStep>,
}

async fn build(conn: &mut SqliteConnection, code: &str) -> Result<PickView> {
    let course = model::course_by_code(conn, code).await?;
    if course.status == "draft" {
        return Ok(PickView {
            title: course.title,
            date: course.date,
            status: course.status,
            theme: course.theme,
            steps: vec![],
            open: vec![],
        });
    }
    let steps = model::steps(conn, &course.id).await?;
    let cands = model::candidates(conn, &course.id).await?;

    let summaries = steps
        .iter()
        .map(|s| {
            let picked = s
                .picked_id
                .as_ref()
                .and_then(|pid| cands.iter().find(|c| &c.id == pid))
                .map(Place::from);
            let state = match (&picked, s.picked_by.as_deref()) {
                (None, _) => "open",
                (Some(_), Some("planner")) => "fixed",
                (Some(_), _) => "done",
            };
            StepSummary {
                id: s.id.clone(),
                kind: s.kind.clone(),
                label: s.label.clone(),
                time: s.time.clone(),
                state,
                picked,
            }
        })
        .collect();

    let open = steps
        .iter()
        .filter(|s| s.picked_id.is_none())
        .map(|s| {
            let luck = validate::LUCK_GAMES.contains(&s.game.as_str());
            OpenStep {
                id: s.id.clone(),
                kind: s.kind.clone(),
                label: s.label.clone(),
                title: s.title.clone(),
                time: s.time.clone(),
                game: s.game.clone(),
                rerolls_left: if luck {
                    (s.rerolls - s.rerolls_used).max(0)
                } else {
                    0
                },
                candidates: cands
                    .iter()
                    .filter(|c| c.step_id == s.id)
                    .map(Place::from)
                    .collect(),
            }
        })
        .collect();
    Ok(PickView {
        title: course.title,
        date: course.date,
        status: course.status,
        theme: course.theme,
        steps: summaries,
        open,
    })
}

async fn view(State(st): State<AppState>, Path(code): Path<String>) -> Result<Json<PickView>> {
    let mut conn = st.db.acquire().await?;
    Ok(Json(build(&mut conn, &code).await?))
}

/// The step must belong to this shared course and still be open (any order is fine); returns
/// (course_id, step) on success.
async fn open_step(
    conn: &mut SqliteConnection,
    code: &str,
    step_id: &str,
) -> Result<(String, model::Step)> {
    let course = model::course_by_code(conn, code).await?;
    match course.status.as_str() {
        "draft" => return Err(conflict("아직 준비 중이야")),
        "done" => return Err(conflict("이미 코스가 완성됐어")),
        _ => {}
    }
    let step = model::steps(conn, &course.id)
        .await?
        .into_iter()
        .find(|s| s.id == step_id)
        .ok_or(AppError::NotFound(
            "단계를 찾을 수 없어. 화면을 새로 고쳐 줘",
        ))?;
    if step.picked_id.is_some() {
        return Err(conflict("이미 정해진 단계야. 화면을 새로 고쳐 줘"));
    }
    Ok((course.id, step))
}

#[derive(Deserialize)]
struct PickBody {
    candidate_id: String,
}

async fn pick(
    State(st): State<AppState>,
    Path((code, step_id)): Path<(String, String)>,
    Json(b): Json<PickBody>,
) -> Result<Json<PickView>> {
    let mut tx = st.db.begin().await?;
    let (course_id, step) = open_step(&mut tx, &code, &step_id).await?;
    let (_, owner_step) = model::candidate_owner(&mut tx, &b.candidate_id).await?;
    if owner_step != step.id {
        return Err(AppError::BadRequest("이 단계의 후보가 아니야".into()));
    }
    sqlx::query(
        "UPDATE steps SET picked_id = ?, picked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), \
         picked_by = 'picker' WHERE id = ?",
    )
    .bind(&b.candidate_id)
    .bind(&step.id)
    .execute(&mut *tx)
    .await?;
    // done once nothing is left to choose
    model::settle(&mut tx, &course_id).await?;
    model::log(
        &mut tx,
        &course_id,
        "picker",
        "pick",
        json!({ "step": step.id, "candidate": b.candidate_id, "game": step.game }),
    )
    .await?;
    let view = build(&mut tx, &code).await?;
    tx.commit().await?;
    Ok(Json(view))
}

#[derive(Serialize)]
struct RerollLeft {
    rerolls_left: i64,
}

async fn reroll(
    State(st): State<AppState>,
    Path((code, step_id)): Path<(String, String)>,
) -> Result<Json<RerollLeft>> {
    let mut tx = st.db.begin().await?;
    let (course_id, step) = open_step(&mut tx, &code, &step_id).await?;
    if !validate::LUCK_GAMES.contains(&step.game.as_str()) || step.rerolls_used >= step.rerolls {
        return Err(conflict("다시 하기 기회를 다 썼어"));
    }
    sqlx::query("UPDATE steps SET rerolls_used = rerolls_used + 1 WHERE id = ?")
        .bind(&step.id)
        .execute(&mut *tx)
        .await?;
    model::log(
        &mut tx,
        &course_id,
        "picker",
        "reroll",
        json!({ "step": step.id }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(RerollLeft {
        rerolls_left: step.rerolls - step.rerolls_used - 1,
    }))
}
