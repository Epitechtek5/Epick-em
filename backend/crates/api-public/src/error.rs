//! Erreurs renvoyées par l'API, au format `{ "error", "message", "errors"? }`.

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use utoipa::ToSchema;

/// Corps de toute réponse d'erreur. Documentation uniquement : `ApiError` construit le JSON.
#[derive(Serialize, ToSchema)]
pub struct ErrorResponse {
    /// Code stable, lisible par une machine.
    #[schema(example = "invalid_request")]
    pub error: String,
    pub message: String,
    /// Message par champ invalide.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<BTreeMap<String, String>>,
}

#[derive(Debug)]
pub enum ApiError {
    /// Corps illisible ou champs invalides, avec le détail par champ.
    Validation(Vec<(&'static str, String)>),
    /// Identifiants ou jeton de rafraîchissement refusés.
    Unauthorized,
    /// Nom d'utilisateur déjà pris.
    Conflict,
    /// Panne côté serveur ; le détail est journalisé, jamais renvoyé.
    Internal(String),
}

impl ApiError {
    pub fn internal(err: impl std::fmt::Display) -> Self {
        ApiError::Internal(err.to_string())
    }
}

impl From<JsonRejection> for ApiError {
    fn from(_: JsonRejection) -> Self {
        ApiError::Validation(Vec::new())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message, fields) = match self {
            ApiError::Validation(fields) => (
                StatusCode::BAD_REQUEST,
                "invalid_request",
                "Requête invalide",
                fields,
            ),
            ApiError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Identifiants ou jeton invalides",
                Vec::new(),
            ),
            ApiError::Conflict => (
                StatusCode::CONFLICT,
                "username_taken",
                "Ce nom d'utilisateur est déjà pris",
                Vec::new(),
            ),
            ApiError::Internal(detail) => {
                eprintln!("api-public : erreur interne : {detail}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal",
                    "Erreur interne",
                    Vec::new(),
                )
            }
        };
        let mut body = json!({ "error": code, "message": message });
        if !fields.is_empty() {
            let errors: Map<String, Value> = fields
                .into_iter()
                .map(|(field, msg)| (field.to_string(), Value::String(msg)))
                .collect();
            body["errors"] = Value::Object(errors);
        }
        (status, Json(body)).into_response()
    }
}
