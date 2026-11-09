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
    /// Nom d'équipe déjà pris pour ce jeu.
    TeamNameTaken,
    /// Le compte est déjà membre de l'équipe.
    AlreadyTeamMember,
    /// Équipe globale déjà inscrite à ce tournoi.
    TeamAlreadyRegistered,
    /// Joueur déjà dans une équipe de ce tournoi.
    PlayerAlreadyRegistered,
    /// Nom de tournoi déjà pris pour ce jeu.
    TournamentNameTaken,
    /// Le barème contient déjà une règle pour cette statistique.
    ScoringRuleTaken,
    /// Joueur ou équipe déjà inscrit à ce tournoi.
    AlreadyRegistered,
    /// Le tournoi a atteint son nombre maximum de participants.
    TournamentFull,
    /// Barème ou paramètres verrouillés : le tournoi est en cours ou terminé.
    TournamentLocked,
    /// Une étape occupe déjà cette position dans le tournoi.
    StepPositionTaken,
    /// Les inscriptions ne sont pas ouvertes.
    RegistrationClosed,
    /// Changement de statut impossible depuis le statut actuel.
    InvalidTransition,
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
            ApiError::TeamNameTaken => (
                StatusCode::CONFLICT,
                "team_name_taken",
                "Ce nom d'équipe est déjà pris pour ce jeu",
            ),
            ApiError::AlreadyTeamMember => (
                StatusCode::CONFLICT,
                "already_team_member",
                "Ce compte est déjà membre de l'équipe",
            ),
            ApiError::TeamAlreadyRegistered => (
                StatusCode::CONFLICT,
                "team_already_registered",
                "Cette équipe est déjà inscrite à ce tournoi",
            ),
            ApiError::PlayerAlreadyRegistered => (
                StatusCode::CONFLICT,
                "player_already_registered",
                "Ce joueur est déjà dans une équipe de ce tournoi",
            ),
            ApiError::TournamentNameTaken => (
                StatusCode::CONFLICT,
                "tournament_name_taken",
                "Ce nom de tournoi est déjà pris pour ce jeu",
            ),
            ApiError::ScoringRuleTaken => (
                StatusCode::CONFLICT,
                "scoring_rule_taken",
                "Le barème de ce tournoi définit déjà cette statistique",
            ),
            ApiError::AlreadyRegistered => (
                StatusCode::CONFLICT,
                "already_registered",
                "Ce participant est déjà inscrit à ce tournoi",
            ),
            ApiError::TournamentFull => (
                StatusCode::CONFLICT,
                "tournament_full",
                "Ce tournoi a atteint son nombre maximum de participants",
            ),
            ApiError::TournamentLocked => (
                StatusCode::CONFLICT,
                "tournament_locked",
                "Le tournoi est en cours ou terminé : cette modification est verrouillée",
            ),
            ApiError::StepPositionTaken => (
                StatusCode::CONFLICT,
                "step_position_taken",
                "Une étape occupe déjà cette position dans le tournoi",
            ),
            ApiError::RegistrationClosed => (
                StatusCode::CONFLICT,
                "registration_closed",
                "Les inscriptions à ce tournoi ne sont pas ouvertes",
            ),
            ApiError::InvalidTransition => (
                StatusCode::CONFLICT,
                "invalid_status_transition",
                "Ce changement de statut n'est pas possible depuis le statut actuel",
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
