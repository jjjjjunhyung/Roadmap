//! Rows, response shapes and the queries shared by both APIs.

use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, SqliteConnection};

use crate::error::{AppError, Result};

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Course {
    pub id: String,
    pub share_code: String,
    pub title: String,
    pub date: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Step {
    pub id: String,
    pub position: i64,
    pub kind: String,
    pub label: String,
    pub title: String,
    pub time: String,
    pub game: String,
    pub rerolls: i64,
    pub rerolls_used: i64,
    pub picked_id: Option<String>,
    pub picked_at: Option<String>,
    /// "picker" (chosen in a game) or "planner" (a single candidate: fixed)
    pub picked_by: Option<String>,
    /// where a movie, show or exhibition step happens (one theater for every candidate)
    pub venue_name: String,
    pub venue_url: String,
    pub venue_lat: Option<f64>,
    pub venue_lng: Option<f64>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Candidate {
    pub id: String,
    pub step_id: String,
    pub position: i64,
    pub name: String,
    pub memo: String,
    pub map_url: String,
    pub image_url: String,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    /// a work's info or booking page
    pub link_url: String,
    /// a work's start time, HH:MM or ""
    pub starts_at: String,
    pub runtime_min: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct StepFull {
    #[serde(flatten)]
    pub step: Step,
    pub candidates: Vec<Candidate>,
    /// where they really went, when the day changed it
    pub actual: Option<Actual>,
}

/// Everything the planner sees for one course.
#[derive(Debug, Serialize)]
pub struct CourseFull {
    #[serde(flatten)]
    pub course: Course,
    pub steps: Vec<StepFull>,
    /// places they dropped by on the day
    pub extras: Vec<Extra>,
}

// Column lists as macros so every query stays a compile-time string literal
// (sqlx 0.9 rejects SQL assembled at runtime).
macro_rules! course_cols {
    () => {
        "id, share_code, title, date, status, created_at, updated_at"
    };
}
macro_rules! step_cols {
    () => {
        "id, position, kind, label, title, time, game, rerolls, rerolls_used, picked_id, picked_at, picked_by, venue_name, venue_url, venue_lat, venue_lng"
    };
}
macro_rules! cand_cols {
    () => {
        "c.id, c.step_id, c.position, c.name, c.memo, c.map_url, c.image_url, c.lat, c.lng, c.link_url, c.starts_at, c.runtime_min"
    };
}

pub async fn course(conn: &mut SqliteConnection, id: &str) -> Result<Course> {
    sqlx::query_as::<_, Course>(concat!(
        "SELECT ",
        course_cols!(),
        " FROM courses WHERE id = ? AND deleted_at IS NULL"
    ))
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound("데이트를 찾을 수 없어"))
}

pub async fn course_by_code(conn: &mut SqliteConnection, code: &str) -> Result<Course> {
    sqlx::query_as::<_, Course>(concat!(
        "SELECT ",
        course_cols!(),
        " FROM courses WHERE share_code = ? AND deleted_at IS NULL"
    ))
    .bind(code)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound("링크를 다시 확인해 줘"))
}

pub async fn steps(conn: &mut SqliteConnection, course_id: &str) -> Result<Vec<Step>> {
    Ok(sqlx::query_as::<_, Step>(concat!(
        "SELECT ",
        step_cols!(),
        " FROM steps WHERE course_id = ? AND deleted_at IS NULL ORDER BY position, rowid"
    ))
    .bind(course_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Live candidates of every live step in a course.
pub async fn candidates(conn: &mut SqliteConnection, course_id: &str) -> Result<Vec<Candidate>> {
    Ok(sqlx::query_as::<_, Candidate>(concat!(
        "SELECT ", cand_cols!(), " FROM candidates c JOIN steps s ON s.id = c.step_id ",
        "WHERE s.course_id = ? AND c.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY c.position, c.rowid"
    ))
    .bind(course_id)
    .fetch_all(&mut *conn)
    .await?)
}

pub async fn full(conn: &mut SqliteConnection, id: &str) -> Result<CourseFull> {
    let course = course(conn, id).await?;
    let steps = steps(conn, id).await?;
    let mut cands = candidates(conn, id).await?;
    let mut actual = actuals(conn, id).await?;
    let extras = extras(conn, id).await?;
    let steps = steps
        .into_iter()
        .map(|step| {
            let (mine, rest): (Vec<_>, Vec<_>) =
                cands.drain(..).partition(|c| c.step_id == step.id);
            cands = rest;
            StepFull {
                actual: actual.remove(&step.id),
                step,
                candidates: mine,
            }
        })
        .collect();
    Ok(CourseFull {
        course,
        steps,
        extras,
    })
}

/// A place they dropped by on the day that was never in the plan.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Extra {
    pub id: String,
    /// the stop it came after; null (or a stop since removed) puts it at the end
    pub after_step_id: Option<String>,
    pub time: String,
    pub kind: String,
    pub name: String,
    pub memo: String,
    pub map_url: String,
    pub image_url: String,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
}

/// The day's extra stops of a course, in the order they were added.
pub async fn extras(conn: &mut SqliteConnection, course_id: &str) -> Result<Vec<Extra>> {
    Ok(sqlx::query_as::<_, Extra>(
        "SELECT id, after_step_id, time, kind, name, memo, map_url, image_url, lat, lng \
         FROM extra_stops WHERE course_id = ? ORDER BY time = '', time, created_at, rowid",
    )
    .bind(course_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Where they really went at a stop, when the day went its own way.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Actual {
    #[serde(skip)]
    pub step_id: String,
    /// they did not go anywhere for this stop
    pub skipped: bool,
    /// where they went instead (empty when skipped)
    pub name: String,
    pub memo: String,
    pub map_url: String,
    pub image_url: String,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
}

/// The day's changes of a course, by step id.
pub async fn actuals(
    conn: &mut SqliteConnection,
    course_id: &str,
) -> Result<std::collections::HashMap<String, Actual>> {
    let rows = sqlx::query_as::<_, Actual>(
        "SELECT a.step_id, a.skipped, a.name, a.memo, a.map_url, a.image_url, a.lat, a.lng \
         FROM step_actual a JOIN steps s ON s.id = a.step_id \
         WHERE s.course_id = ? AND s.deleted_at IS NULL",
    )
    .bind(course_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows.into_iter().map(|a| (a.step_id.clone(), a)).collect())
}

/// Step with its course id, for endpoints addressed by step id.
pub async fn step_course(conn: &mut SqliteConnection, step_id: &str) -> Result<String> {
    sqlx::query_scalar::<_, String>(
        "SELECT s.course_id FROM steps s JOIN courses c ON c.id = s.course_id \
         WHERE s.id = ? AND s.deleted_at IS NULL AND c.deleted_at IS NULL",
    )
    .bind(step_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound("단계를 찾을 수 없어"))
}

/// (course_id, step_id) of a live candidate.
pub async fn candidate_owner(
    conn: &mut SqliteConnection,
    cand_id: &str,
) -> Result<(String, String)> {
    sqlx::query_as::<_, (String, String)>(
        "SELECT s.course_id, s.id FROM candidates c JOIN steps s ON s.id = c.step_id JOIN courses k ON k.id = s.course_id \
         WHERE c.id = ? AND c.deleted_at IS NULL AND s.deleted_at IS NULL AND k.deleted_at IS NULL",
    )
    .bind(cand_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound("후보를 찾을 수 없어"))
}

/// After any change to a course: bump updated_at, then settle which steps are fixed.
pub async fn changed(conn: &mut SqliteConnection, course_id: &str) -> Result<()> {
    touch(conn, course_id).await?;
    settle(conn, course_id).await
}

/// A step with exactly one candidate is decided by the planner ("정해 둠"): once the course is
/// shared it counts as picked, and one that gains a second candidate becomes a game again. The
/// course is then done when every step is decided, open otherwise. Drafts are left alone.
pub async fn settle(conn: &mut SqliteConnection, course_id: &str) -> Result<()> {
    let status: String = sqlx::query_scalar("SELECT status FROM courses WHERE id = ?")
        .bind(course_id)
        .fetch_one(&mut *conn)
        .await?;
    if status == "draft" {
        return Ok(());
    }
    // undo planner picks that no longer hold (more than one candidate, or its candidate is gone)
    sqlx::query(
        "UPDATE steps SET picked_id = NULL, picked_at = NULL, picked_by = NULL \
         WHERE course_id = ?1 AND deleted_at IS NULL AND picked_by = 'planner' AND ( \
           (SELECT count(*) FROM candidates c WHERE c.step_id = steps.id AND c.deleted_at IS NULL) != 1 \
           OR NOT EXISTS (SELECT 1 FROM candidates c WHERE c.id = steps.picked_id AND c.deleted_at IS NULL))",
    )
    .bind(course_id)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE steps SET \
           picked_id = (SELECT c.id FROM candidates c WHERE c.step_id = steps.id AND c.deleted_at IS NULL), \
           picked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), picked_by = 'planner' \
         WHERE course_id = ?1 AND deleted_at IS NULL AND picked_id IS NULL \
           AND (SELECT count(*) FROM candidates c WHERE c.step_id = steps.id AND c.deleted_at IS NULL) = 1",
    )
    .bind(course_id)
    .execute(&mut *conn)
    .await?;
    let open: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM steps WHERE course_id = ? AND deleted_at IS NULL AND picked_id IS NULL",
    )
    .bind(course_id)
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query("UPDATE courses SET status = ? WHERE id = ?")
        .bind(if open > 0 { "open" } else { "done" })
        .bind(course_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// How the pages behind the birthday look: "plain" or "holiday" (winter night, snow, string
/// lights). One switch for the whole site, set by the planner.
pub async fn theme(conn: &mut SqliteConnection) -> Result<String> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT value FROM app_info WHERE key = 'theme'")
            .fetch_optional(&mut *conn)
            .await?
            .filter(|t| THEMES.contains(&t.as_str()))
            .unwrap_or_else(|| "plain".into()),
    )
}

pub const THEMES: [&str; 2] = ["plain", "holiday"];

pub async fn touch(conn: &mut SqliteConnection, course_id: &str) -> Result<()> {
    sqlx::query(
        "UPDATE courses SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?",
    )
    .bind(course_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

pub async fn log(
    conn: &mut SqliteConnection,
    course_id: &str,
    actor: &str,
    action: &str,
    detail: Value,
) -> Result<()> {
    sqlx::query("INSERT INTO history (course_id, actor, action, detail) VALUES (?, ?, ?, ?)")
        .bind(course_id)
        .bind(actor)
        .bind(action)
        .bind(detail.to_string())
        .execute(&mut *conn)
        .await?;
    Ok(())
}
