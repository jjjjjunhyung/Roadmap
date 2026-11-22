use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

/// API error with a user-facing (Korean) message.
#[derive(Debug)]
pub enum AppError {
    NotFound(&'static str),
    BadRequest(String),
    Conflict(String),
    Forbidden(String),
    Unauthorized(&'static str),
    Internal(anyhow::Error),
}

pub type Result<T> = std::result::Result<T, AppError>;

pub fn bad(msg: impl Into<String>) -> AppError {
    AppError::BadRequest(msg.into())
}

pub fn conflict(msg: impl Into<String>) -> AppError {
    AppError::Conflict(msg.into())
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Internal(e.into())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AppError::NotFound(m) => (StatusCode::NOT_FOUND, m.to_string()),
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            AppError::Conflict(m) => (StatusCode::CONFLICT, m),
            AppError::Forbidden(m) => (StatusCode::FORBIDDEN, m),
            AppError::Unauthorized(m) => (StatusCode::UNAUTHORIZED, m.to_string()),
            AppError::Internal(e) => {
                tracing::error!(error = ?e, "internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "잠시 후 다시 시도해 줘".to_string(),
                )
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}
