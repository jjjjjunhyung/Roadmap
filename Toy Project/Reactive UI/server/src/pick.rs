//! Picker API (/api/pick/{code}): the shared link. Only the current step's
//! candidates ever leave the server, so later steps stay a surprise.

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
    /// "done" | "current" | "locked"
    state: &'static str,
    picked: Option<Place>,
}

#[derive(Serialize)]
pub struct CurrentStep {
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
    steps: Vec<StepSummary>,
    current: Option<CurrentStep>,
}

async fn build(conn: &mut SqliteConnection, code: &str) -> Result<PickView> {
    let course = model::course_by_code(conn, code).await?;
    if course.status == "draft" {
        return Ok(PickView {
            title: course.title,
            date: course.date,
            status: course.status,
            steps: vec![],
            current: None,
        });
    }
    let steps = model::steps(conn, &course.id).await?;
    let cands = model::candidates(conn, &course.id).await?;
    let current_idx = steps.iter().position(|s| s.picked_id.is_none());

    let summaries = steps
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let picked = s
                .picked_id
                .as_ref()
                .and_then(|pid| cands.iter().find(|c| &c.id == pid))
                .map(Place::from);
            let state = if picked.is_some() {
                "done"
            } else if Some(i) == current_idx {
                "current"
            } else {
                "locked"
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

    let current = current_idx.map(|i| {
        let s = &steps[i];
        let luck = validate::LUCK_GAMES.contains(&s.game.as_str());
        CurrentStep {
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
    });
    Ok(PickView {
        title: course.title,
        date: course.date,
        status: course.status,
        steps: summaries,
        current,
    })
}

async fn view(State(st): State<AppState>, Path(code): Path<String>) -> Result<Json<PickView>> {
    let mut conn = st.db.acquire().await?;
    Ok(Json(build(&mut conn, &code).await?))
}

/// The step must be the current one; returns (course_id, step) on success.
async fn current_step(
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
    let steps = model::steps(conn, &course.id).await?;
    let cur = steps
        .into_iter()
        .find(|s| s.picked_id.is_none())
        .ok_or_else(|| conflict("이미 코스가 완성됐어"))?;
    if cur.id != step_id {
        return Err(conflict("지금 고를 차례가 아니야. 화면을 새로 고쳐 줘"));
    }
    Ok((course.id, cur))
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
    let (course_id, step) = current_step(&mut tx, &code, &step_id).await?;
    let (_, owner_step) = model::candidate_owner(&mut tx, &b.candidate_id).await?;
    if owner_step != step.id {
        return Err(AppError::BadRequest("이 단계의 후보가 아니야".into()));
    }
    sqlx::query("UPDATE steps SET picked_id = ?, picked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
        .bind(&b.candidate_id)
        .bind(&step.id)
        .execute(&mut *tx)
        .await?;
    let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM steps WHERE course_id = ? AND deleted_at IS NULL AND picked_id IS NULL")
        .bind(&course_id)
        .fetch_one(&mut *tx)
        .await?;
    if remaining == 0 {
        sqlx::query("UPDATE courses SET status = 'done' WHERE id = ?")
            .bind(&course_id)
            .execute(&mut *tx)
            .await?;
    }
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
    let (course_id, step) = current_step(&mut tx, &code, &step_id).await?;
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
