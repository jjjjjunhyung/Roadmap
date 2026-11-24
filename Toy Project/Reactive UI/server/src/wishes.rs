//! Wishlist: places someone wants to go, kept from the archive (behind the birthday) with a map
//! link; the planner turns a wish into a candidate in one tap.
//!
//! A pasted link (or Naver Map's whole share text) is read like a candidate's: name, kind,
//! neighbourhood, a photo and the location come from the place page. The archive never shows
//! that a wish went into a course still to come (that would spoil it); a wish only shows
//! "다녀왔어" once a finished course picked it.

use std::collections::HashMap;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    AppState, archive,
    error::{AppError, Result, bad, conflict},
    model::{self, CourseFull},
    naver, validate as v,
};

const MAX_WISHES: i64 = 200;

/// Archive side, behind the birthday.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/archive/wishes", get(list).post(add))
        .route("/archive/wishes/{id}", delete(remove))
}

/// Planner side, behind the planner key.
pub fn planner_router() -> Router<AppState> {
    Router::new()
        .route("/wishes", get(planner_list))
        .route("/steps/{id}/wishes", post(to_candidate))
}

#[derive(Serialize, sqlx::FromRow)]
struct Row {
    id: String,
    name: String,
    memo: String,
    map_url: String,
    image_url: String,
    category: String,
    area: String,
    created_at: i64,
}

/// A finished course that picked this wish.
#[derive(Serialize, Clone)]
struct Visit {
    title: String,
    date: String,
    share_code: String,
}

#[derive(Serialize)]
struct Wish {
    #[serde(flatten)]
    row: Row,
    visited: Option<Visit>,
}

/// A course (any state) that has this wish among its candidates; planner only.
#[derive(Serialize, Clone)]
struct Use {
    course_id: String,
    title: String,
    date: String,
    status: String,
}

#[derive(Serialize)]
struct PlannerWish {
    #[serde(flatten)]
    wish: Wish,
    used: Vec<Use>,
}

async fn rows(st: &AppState) -> Result<Vec<Row>> {
    Ok(sqlx::query_as::<_, Row>(
        "SELECT id, name, memo, map_url, image_url, category, area, created_at FROM wishes \
         WHERE deleted_at IS NULL ORDER BY created_at DESC, rowid DESC",
    )
    .fetch_all(&st.db)
    .await?)
}

/// wish id → the latest finished course that picked it.
async fn visits(st: &AppState) -> Result<HashMap<String, Visit>> {
    let found = sqlx::query_as::<_, (String, String, String, String)>(
        "SELECT c.wish_id, k.title, k.date, k.share_code FROM candidates c \
         JOIN steps s ON s.id = c.step_id AND s.picked_id = c.id \
         JOIN courses k ON k.id = s.course_id \
         WHERE c.wish_id IS NOT NULL AND c.deleted_at IS NULL AND s.deleted_at IS NULL \
           AND k.deleted_at IS NULL AND k.status = 'done' ORDER BY k.date",
    )
    .fetch_all(&st.db)
    .await?;
    Ok(found
        .into_iter()
        .map(|(w, title, date, share_code)| {
            (
                w,
                Visit {
                    title,
                    date,
                    share_code,
                },
            )
        })
        .collect())
}

/// Not yet visited first (newest first), then the ones already visited.
async fn wishes(st: &AppState) -> Result<Vec<Wish>> {
    let visited = visits(st).await?;
    let mut all: Vec<Wish> = rows(st)
        .await?
        .into_iter()
        .map(|row| Wish {
            visited: visited.get(&row.id).cloned(),
            row,
        })
        .collect();
    all.sort_by_key(|w| w.visited.is_some());
    Ok(all)
}

async fn list(State(st): State<AppState>, headers: HeaderMap) -> Result<Response> {
    archive::require(&st, &headers)?;
    Ok(archive::private(Json(wishes(&st).await?).into_response()))
}

#[derive(Deserialize)]
struct NewWish {
    /// a map link, or a whole share text with one in it
    #[serde(default)]
    link: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    memo: String,
}

/// The first web address in pasted text ("[네이버 지도]\n홍명\n…\nhttps://naver.me/x").
fn link_in(text: &str) -> Option<&str> {
    let start = text.find("https://").or_else(|| text.find("http://"))?;
    let rest = &text[start..];
    let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    Some(rest[..end].trim_end_matches(['.', ',', ')', ']', '>']))
}

async fn add(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<NewWish>,
) -> Result<(StatusCode, Response)> {
    archive::require(&st, &headers)?;
    let map_url = v::map_url(link_in(&body.link).unwrap_or(""))?;
    let memo = v::optional_text(&body.memo, "메모", 80)?;
    if map_url.is_empty() && body.name.trim().is_empty() {
        return Err(bad("지도 링크를 붙이거나 이름을 적어 줘"));
    }
    if !map_url.is_empty() {
        let dup: bool = sqlx::query_scalar(
            "SELECT count(*) > 0 FROM wishes WHERE map_url = ? AND deleted_at IS NULL",
        )
        .bind(&map_url)
        .fetch_one(&st.db)
        .await?;
        if dup {
            return Err(conflict("이미 담아 둔 곳이야"));
        }
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM wishes WHERE deleted_at IS NULL")
        .fetch_one(&st.db)
        .await?;
    if count >= MAX_WISHES {
        return Err(bad(format!(
            "가고 싶은 곳은 {MAX_WISHES}곳까지 담을 수 있어"
        )));
    }

    let place = naver::place(&map_url).await;
    let name = match (body.name.trim(), place.name.as_deref()) {
        ("", Some(found)) => v::text(found, "이름", 40)?,
        ("", None) => return Err(bad("장소 이름을 찾지 못했어. 이름을 같이 적어 줘")),
        (typed, _) => v::text(typed, "이름", 40)?,
    };
    let (lat, lng) = place.at.unzip();
    let row = sqlx::query_as::<_, Row>(
        "INSERT INTO wishes (name, memo, map_url, image_url, category, area, lat, lng) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
         RETURNING id, name, memo, map_url, image_url, category, area, created_at",
    )
    .bind(&name)
    .bind(&memo)
    .bind(&map_url)
    .bind(place.first_photo())
    .bind(place.category.unwrap_or_default())
    .bind(place.area.unwrap_or_default())
    .bind(lat)
    .bind(lng)
    .fetch_one(&st.db)
    .await?;
    let wish = Wish { row, visited: None };
    Ok((
        StatusCode::CREATED,
        archive::private(Json(wish).into_response()),
    ))
}

async fn remove(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    archive::require(&st, &headers)?;
    let done = sqlx::query(
        "UPDATE wishes SET deleted_at = unixepoch() WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&id)
    .execute(&st.db)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound("이미 지운 곳이야"));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ------------------------------------------------------------------ planner

async fn planner_list(State(st): State<AppState>) -> Result<Json<Vec<PlannerWish>>> {
    let uses = sqlx::query_as::<_, (String, String, String, String, String)>(
        "SELECT DISTINCT c.wish_id, k.id, k.title, k.date, k.status FROM candidates c \
         JOIN steps s ON s.id = c.step_id JOIN courses k ON k.id = s.course_id \
         WHERE c.wish_id IS NOT NULL AND c.deleted_at IS NULL AND s.deleted_at IS NULL \
           AND k.deleted_at IS NULL ORDER BY k.date",
    )
    .fetch_all(&st.db)
    .await?;
    let mut by_wish: HashMap<String, Vec<Use>> = HashMap::new();
    for (wish, course_id, title, date, status) in uses {
        by_wish.entry(wish).or_default().push(Use {
            course_id,
            title,
            date,
            status,
        });
    }
    Ok(Json(
        wishes(&st)
            .await?
            .into_iter()
            .map(|wish| PlannerWish {
                used: by_wish.remove(&wish.row.id).unwrap_or_default(),
                wish,
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
struct FromWish {
    wish_id: String,
}

/// Adds a wish to a step as a candidate (name, memo, link, photo and location carried over).
async fn to_candidate(
    State(st): State<AppState>,
    Path(step_id): Path<String>,
    Json(body): Json<FromWish>,
) -> Result<(StatusCode, Json<CourseFull>)> {
    type W = (String, String, String, String, Option<f64>, Option<f64>);
    let (name, memo, map_url, image_url, lat, lng): W = sqlx::query_as(
        "SELECT name, memo, map_url, image_url, lat, lng FROM wishes WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&body.wish_id)
    .fetch_optional(&st.db)
    .await?
    .ok_or(AppError::NotFound("위시리스트에서 지워진 곳이야"))?;
    let name: String = name.chars().take(30).collect();

    let mut tx = st.db.begin().await?;
    let course_id = model::step_course(&mut tx, &step_id).await?;
    let (count, already): (i64, i64) = sqlx::query_as(
        "SELECT count(*), count(CASE WHEN wish_id = ? THEN 1 END) FROM candidates \
         WHERE step_id = ? AND deleted_at IS NULL",
    )
    .bind(&body.wish_id)
    .bind(&step_id)
    .fetch_one(&mut *tx)
    .await?;
    if already > 0 {
        return Err(conflict("이 단계에 이미 넣었어"));
    }
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
        "INSERT INTO candidates (step_id, position, name, memo, map_url, image_url, lat, lng, wish_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&step_id)
    .bind(next)
    .bind(&name)
    .bind(&memo)
    .bind(&map_url)
    .bind(&image_url)
    .bind(lat)
    .bind(lng)
    .bind(&body.wish_id)
    .execute(&mut *tx)
    .await?;
    model::changed(&mut tx, &course_id).await?;
    model::log(
        &mut tx,
        &course_id,
        "planner",
        "candidate.add",
        json!({ "step": step_id, "name": name, "wish": body.wish_id }),
    )
    .await?;
    let full = model::full(&mut tx, &course_id).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(full)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_link_in_shared_text() {
        assert_eq!(
            link_in("https://naver.me/abc"),
            Some("https://naver.me/abc")
        );
        assert_eq!(
            link_in("[네이버 지도]\n홍명\n서울 강남구 논현로 10\nhttps://naver.me/x1Y2 "),
            Some("https://naver.me/x1Y2")
        );
        assert_eq!(
            link_in("여기 (https://map.naver.com/p/1)."),
            Some("https://map.naver.com/p/1")
        );
        assert_eq!(link_in("한강 피크닉"), None);
    }
}
