//! Erreurs renvoyées par l'API, au format `{ "error", "message", "errors"? }`.

use actix_web::http::StatusCode;
use actix_web::{HttpResponse, ResponseError, error};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::fmt;
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
    /// Identifiants ou jeton refusés.
    Unauthorized,
    /// Authentifié, mais sans le rôle exigé ou sans droit sur cette ressource.
    Forbidden,
    /// Compte ou jeu introuvable.
    NotFound,
    /// Nom d'utilisateur déjà pris.
    Conflict,
    /// Nom de jeu déjà pris.
    GameNameTaken,
    /// Clé de statistique déjà prise.
    StatKeyTaken,
    /// Statistique utilisée par un tournoi en cours.
    StatInUse,
    /// Panne côté serveur ; le détail est journalisé, jamais renvoyé.
    Internal(String),
}

impl ApiError {
    pub fn internal(err: impl fmt::Display) -> Self {
        ApiError::Internal(err.to_string())
    }

    fn parts(&self) -> (StatusCode, &'static str, &'static str) {
        match self {
            ApiError::Validation(_) => (
                StatusCode::BAD_REQUEST,
                "invalid_request",
                "Requête invalide",
            ),
            ApiError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Identifiants ou jeton invalides",
            ),
            ApiError::Forbidden => (StatusCode::FORBIDDEN, "forbidden", "Action non autorisée"),
            ApiError::NotFound => (StatusCode::NOT_FOUND, "not_found", "Ressource introuvable"),
            ApiError::Conflict => (
                StatusCode::CONFLICT,
                "username_taken",
                "Ce nom d'utilisateur est déjà pris",
            ),
            ApiError::GameNameTaken => (
                StatusCode::CONFLICT,
                "game_name_taken",
                "Ce nom de jeu est déjà pris",
            ),
            ApiError::StatKeyTaken => (
                StatusCode::CONFLICT,
                "stat_key_taken",
                "Cette clé de statistique est déjà prise",
            ),
            ApiError::StatInUse => (
                StatusCode::CONFLICT,
                "stat_in_use",
                "Cette statistique est utilisée par un tournoi en cours",
            ),
            ApiError::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal",
                "Erreur interne",
            ),
        }
    }
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.parts().2)
    }
}

/// Corps JSON illisible : même format d'erreur que les handlers, sans détail par champ.
impl From<error::JsonPayloadError> for ApiError {
    fn from(_: error::JsonPayloadError) -> Self {
        ApiError::Validation(Vec::new())
    }
}

impl ResponseError for ApiError {
    fn status_code(&self) -> StatusCode {
        self.parts().0
    }

    fn error_response(&self) -> HttpResponse {
        let (status, code, message) = self.parts();
        if let ApiError::Internal(detail) = self {
            eprintln!("api-public : erreur interne : {detail}");
        }
        let mut body = json!({ "error": code, "message": message });
        if let ApiError::Validation(fields) = self
            && !fields.is_empty()
        {
            let errors: Map<String, Value> = fields
                .iter()
                .map(|(field, msg)| ((*field).to_string(), Value::String(msg.clone())))
                .collect();
            body["errors"] = Value::Object(errors);
        }
        HttpResponse::build(status).json(body)
    }
}
