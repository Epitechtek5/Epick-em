//! Erreurs des handlers, converties en réponse JSON `{"error": "..."}`.

use actix_web::http::StatusCode;
use actix_web::{HttpResponse, ResponseError};
use serde::Serialize;
use std::fmt;

#[derive(Debug)]
pub enum ApiError {
    BadRequest(String),
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict(String),
    Internal,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    error: &'a str,
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            ApiError::BadRequest(message) | ApiError::Conflict(message) => message,
            ApiError::Unauthorized => "authentification requise",
            ApiError::Forbidden => "action non autorisée",
            ApiError::NotFound => "utilisateur introuvable",
            ApiError::Internal => "erreur interne",
        };
        f.write_str(message)
    }
}

impl ResponseError for ApiError {
    fn status_code(&self) -> StatusCode {
        match self {
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized => StatusCode::UNAUTHORIZED,
            ApiError::Forbidden => StatusCode::FORBIDDEN,
            ApiError::NotFound => StatusCode::NOT_FOUND,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
            ApiError::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn error_response(&self) -> HttpResponse {
        HttpResponse::build(self.status_code()).json(ErrorBody {
            error: &self.to_string(),
        })
    }
}

impl From<domain::user::ValidationError> for ApiError {
    fn from(err: domain::user::ValidationError) -> Self {
        ApiError::BadRequest(err.0)
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        if let sqlx::Error::Database(db_err) = &err
            && db_err.is_unique_violation()
        {
            return ApiError::Conflict("ce nom d'utilisateur est déjà pris".into());
        }
        eprintln!("erreur base de données : {err}");
        ApiError::Internal
    }
}
