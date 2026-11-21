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
}

#[derive(Debug, Serialize)]
pub struct StepFull {
    #[serde(flatten)]
    pub step: Step,
    pub candidates: Vec<Candidate>,
}

/// Everything the planner sees for one course.
#[derive(Debug, Serialize)]
pub struct CourseFull {
    #[serde(flatten)]
    pub course: Course,
    pub steps: Vec<StepFull>,
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
        "id, position, kind, label, title, time, game, rerolls, rerolls_used, picked_id, picked_at"
    };
}
macro_rules! cand_cols {
    () => {
        "c.id, c.step_id, c.position, c.name, c.memo, c.map_url, c.image_url, c.lat, c.lng"
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
    let steps = steps
        .into_iter()
        .map(|step| {
            let (mine, rest): (Vec<_>, Vec<_>) =
                cands.drain(..).partition(|c| c.step_id == step.id);
            cands = rest;
            StepFull {
                step,
                candidates: mine,
            }
        })
        .collect();
    Ok(CourseFull { course, steps })
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
