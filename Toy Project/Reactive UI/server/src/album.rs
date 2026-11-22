//! Album: photos of a course's day, for people signed in with the birthday (see `archive`).
//!
//! The browser shrinks a photo before sending it; the server then decodes and re-encodes every
//! one, so only pixels are kept (no location, camera or other metadata, nothing hidden in the
//! file), and makes a thumbnail. Photos live in SQLite beside the course and are only served to a
//! signed-in browser, marked private so Cloudflare never caches them.

use std::io::Cursor;

use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use image::{
    DynamicImage, ImageDecoder, ImageReader, Limits, codecs::jpeg::JpegEncoder,
    imageops::FilterType,
};
use serde::{Deserialize, Serialize};

use crate::{
    AppState, archive,
    error::{AppError, Result, bad},
    model,
};

/// Largest upload accepted (the browser normally sends well under 1 MB).
const MAX_UPLOAD: usize = 15 * 1024 * 1024;
/// Longest side of the kept photo and of its thumbnail.
const FULL: u32 = 1600;
const THUMB: u32 = 480;
const PER_COURSE: i64 = 300;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/archive/courses/{code}/photos",
            get(list)
                .post(upload)
                .layer(DefaultBodyLimit::max(MAX_UPLOAD)),
        )
        .route("/archive/photos/{id}", get(full).delete(remove))
        .route("/archive/photos/{id}/thumb", get(thumb))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Photo {
    id: String,
    /// the stop it was taken at; null for the day in general
    step_id: Option<String>,
    width: i64,
    height: i64,
    created_at: i64,
}

/// A shared (not draft) course by its link code.
async fn course_id(st: &AppState, code: &str) -> Result<String> {
    let mut conn = st.db.acquire().await?;
    let c = model::course_by_code(&mut conn, code).await?;
    if c.status == "draft" {
        return Err(AppError::NotFound("링크를 다시 확인해 줘"));
    }
    Ok(c.id)
}

async fn list(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(code): Path<String>,
) -> Result<Response> {
    archive::require(&st, &headers)?;
    let course = course_id(&st, &code).await?;
    let photos = sqlx::query_as::<_, Photo>(
        "SELECT id, step_id, width, height, created_at FROM photos WHERE course_id = ? \
         ORDER BY created_at, rowid",
    )
    .bind(&course)
    .fetch_all(&st.db)
    .await?;
    Ok(archive::private(Json(photos).into_response()))
}

#[derive(Deserialize)]
struct UploadQuery {
    step: Option<String>,
}

struct Processed {
    full: Vec<u8>,
    thumb: Vec<u8>,
    width: u32,
    height: u32,
}

fn jpeg(img: &DynamicImage, quality: u8) -> image::ImageResult<Vec<u8>> {
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, quality).encode_image(&img.to_rgb8())?;
    Ok(out)
}

/// Decodes (upright, within sane limits) and re-encodes: the kept photo and its thumbnail.
fn process(bytes: &[u8]) -> Result<Processed> {
    let unreadable = || bad("사진으로 읽을 수 없어. JPG나 PNG 사진으로 올려 줘");
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| unreadable())?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(12_000);
    limits.max_image_height = Some(12_000);
    limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|_| unreadable())?;
    let orientation = decoder.orientation().ok();
    let mut img = DynamicImage::from_decoder(decoder).map_err(|_| unreadable())?;
    if let Some(o) = orientation {
        img.apply_orientation(o);
    }
    if img.width().max(img.height()) > FULL {
        img = img.resize(FULL, FULL, FilterType::CatmullRom);
    }
    let thumb = img.thumbnail(THUMB, THUMB);
    let encode = |e: image::ImageError| AppError::Internal(e.into());
    Ok(Processed {
        full: jpeg(&img, 84).map_err(encode)?,
        thumb: jpeg(&thumb, 78).map_err(encode)?,
        width: img.width(),
        height: img.height(),
    })
}

async fn upload(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(code): Path<String>,
    Query(q): Query<UploadQuery>,
    body: Bytes,
) -> Result<(StatusCode, Json<Photo>)> {
    archive::require(&st, &headers)?;
    let course = course_id(&st, &code).await?;
    if body.is_empty() {
        return Err(bad("사진을 골라 줘"));
    }
    let step = match q.step.filter(|s| !s.is_empty()) {
        Some(step) => {
            let owner = {
                let mut conn = st.db.acquire().await?;
                model::step_course(&mut conn, &step).await.ok()
            };
            if owner.as_deref() != Some(course.as_str()) {
                return Err(bad("이 데이트의 장소가 아니야"));
            }
            Some(step)
        }
        None => None,
    };
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM photos WHERE course_id = ?")
        .bind(&course)
        .fetch_one(&st.db)
        .await?;
    if count >= PER_COURSE {
        return Err(bad(format!("사진은 데이트마다 {PER_COURSE}장까지야")));
    }

    let p = tokio::task::spawn_blocking(move || process(&body))
        .await
        .map_err(|e| AppError::Internal(e.into()))??;
    let photo = sqlx::query_as::<_, Photo>(
        "INSERT INTO photos (course_id, step_id, width, height, full, thumb) \
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id, step_id, width, height, created_at",
    )
    .bind(&course)
    .bind(&step)
    .bind(p.width as i64)
    .bind(p.height as i64)
    .bind(p.full)
    .bind(p.thumb)
    .fetch_one(&st.db)
    .await?;
    Ok((StatusCode::CREATED, Json(photo)))
}

/// The image itself: private to this browser (a week), never in a shared cache.
fn image_response(bytes: Vec<u8>) -> Response {
    (
        [
            (header::CONTENT_TYPE, "image/jpeg"),
            (header::CACHE_CONTROL, "private, max-age=604800, immutable"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response()
}

async fn bytes_of(st: &AppState, id: &str, thumb: bool) -> Result<Vec<u8>> {
    let sql = if thumb {
        "SELECT p.thumb FROM photos p JOIN courses c ON c.id = p.course_id \
         WHERE p.id = ? AND c.deleted_at IS NULL"
    } else {
        "SELECT p.full FROM photos p JOIN courses c ON c.id = p.course_id \
         WHERE p.id = ? AND c.deleted_at IS NULL"
    };
    sqlx::query_scalar::<_, Vec<u8>>(sql)
        .bind(id)
        .fetch_optional(&st.db)
        .await?
        .ok_or(AppError::NotFound("사진을 찾을 수 없어"))
}

async fn full(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response> {
    archive::require(&st, &headers)?;
    Ok(image_response(bytes_of(&st, &id, false).await?))
}

async fn thumb(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response> {
    archive::require(&st, &headers)?;
    Ok(image_response(bytes_of(&st, &id, true).await?))
}

/// Deleting a photo removes it for good (not a soft delete: it is personal).
async fn remove(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    archive::require(&st, &headers)?;
    let done = sqlx::query("DELETE FROM photos WHERE id = ?")
        .bind(&id)
        .execute(&st.db)
        .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound("사진을 찾을 수 없어"));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    fn sample(w: u32, h: u32) -> Vec<u8> {
        let img = ImageBuffer::from_fn(w, h, |x, y| Rgb([(x % 255) as u8, (y % 255) as u8, 90]));
        jpeg(&DynamicImage::ImageRgb8(img), 90).unwrap()
    }

    /// A JPEG with an EXIF block (as a phone writes it) right after the start marker.
    fn with_exif(jpg: &[u8]) -> Vec<u8> {
        let payload = b"Exif\0\0MM\0*GPS 37.5665 N 126.9780 E";
        let len = (payload.len() + 2) as u16;
        let mut out = jpg[..2].to_vec();
        out.extend([0xFF, 0xE1]);
        out.extend(len.to_be_bytes());
        out.extend(payload);
        out.extend(&jpg[2..]);
        out
    }

    #[test]
    fn shrinks_and_drops_metadata() {
        let p = process(&with_exif(&sample(3000, 2000))).unwrap();
        assert_eq!((p.width, p.height), (1600, 1067));
        assert!(p.thumb.len() < p.full.len());
        for bytes in [&p.full, &p.thumb] {
            assert_eq!(&bytes[..2], &[0xFF, 0xD8]);
            assert!(!bytes.windows(4).any(|w| w == b"Exif"), "metadata kept");
            assert!(!bytes.windows(3).any(|w| w == b"GPS"), "location kept");
        }
        let small = process(&sample(800, 600)).unwrap();
        assert_eq!(
            (small.width, small.height),
            (800, 600),
            "small photos keep their size"
        );
    }

    #[test]
    fn refuses_what_is_not_a_photo() {
        assert!(process(b"definitely not an image").is_err());
        assert!(process(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 1, 2]).is_err());
    }
}
