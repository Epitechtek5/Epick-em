//! Réglages du compte (langue, thème, préférences de notification) et appareils push.
//!
//! Toutes ces routes agissent uniquement sur le compte du jeton d'accès : aucun identifiant de
//! compte n'est accepté, un utilisateur ne peut donc ni lire ni modifier les réglages d'un autre.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::push::is_valid_token;
use crate::store::{Category, Language, Platform, SettingsUpdate, Theme, UserSettings};
use crate::store::{Channel, PushToken};
use actix_web::{HttpResponse, delete, get, patch, post, web};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use utoipa::ToSchema;
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(get_settings)
        .service(update_settings)
        .service(register_push_token)
        .service(revoke_push_token);
}

/// Préférences d'une catégorie ; un canal omis reste inchangé.
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct ChannelPatch {
    email: Option<bool>,
    push: Option<bool>,
}

/// Modification partielle des réglages : seuls les champs fournis changent.
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct UpdateSettingsRequest {
    language: Option<Language>,
    theme: Option<Theme>,
    /// Préférences par catégorie (`tournaments`, `teams`, `matches`, `predictions`, `pickem`,
    /// `rankings`, `account`).
    #[schema(example = json!({"teams": {"email": false}}))]
    notifications: Option<BTreeMap<Category, ChannelPatch>>,
}

/// Réglages du compte, toujours complets.
#[utoipa::path(
    get,
    path = "/me/settings",
    tag = "settings",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Réglages du compte (valeurs par défaut si jamais modifiés)", body = UserSettings),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Compte introuvable", body = ErrorResponse),
    ),
)]
#[get("/me/settings")]
async fn get_settings(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
) -> Result<HttpResponse, ApiError> {
    let settings = state
        .store
        .user_settings(claims.sub)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(settings))
}

/// Modifie les réglages du compte (mise à jour partielle).
#[utoipa::path(
    patch,
    path = "/me/settings",
    tag = "settings",
    security(("bearer" = [])),
    request_body = UpdateSettingsRequest,
    responses(
        (status = 200, description = "Réglages après modification", body = UserSettings),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Compte introuvable", body = ErrorResponse),
    ),
)]
#[patch("/me/settings")]
async fn update_settings(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    body: web::Json<UpdateSettingsRequest>,
) -> Result<HttpResponse, ApiError> {
    let UpdateSettingsRequest {
        language,
        theme,
        notifications,
    } = body.into_inner();
    let mut changes = Vec::new();
    for (category, patch) in notifications.unwrap_or_default() {
        for (channel, value) in [(Channel::Email, patch.email), (Channel::Push, patch.push)] {
            if let Some(value) = value {
                changes.push((category, channel, value));
            }
        }
    }
    if language.is_none() && theme.is_none() && changes.is_empty() {
        return Err(ApiError::Validation(vec![(
            "body",
            "Renseignez au moins un réglage à modifier.".to_string(),
        )]));
    }
    let settings = state
        .store
        .update_user_settings(
            claims.sub,
            SettingsUpdate {
                language,
                theme,
                notifications: changes,
            },
        )
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(settings))
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct RegisterPushTokenRequest {
    /// Jeton Expo de l'appareil, de la forme `ExponentPushToken[...]`.
    #[schema(
        max_length = 256,
        example = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
    )]
    token: String,
    platform: Platform,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct RevokePushTokenRequest {
    #[schema(max_length = 256)]
    token: String,
}

/// Appareil enregistré. Le jeton n'est jamais renvoyé.
#[derive(Serialize, ToSchema)]
struct PushRegistration {
    id: Uuid,
    platform: Platform,
}

impl From<PushToken> for PushRegistration {
    fn from(token: PushToken) -> Self {
        PushRegistration {
            id: token.id,
            platform: token.platform,
        }
    }
}

/// Enregistre l'appareil courant pour les notifications push. Enregistrer deux fois le même
/// jeton est sans effet ; un jeton déjà lié à un autre compte lui est retiré (l'appareil a
/// changé de compte). Au-delà de 10 appareils, les plus anciens sont retirés.
#[utoipa::path(
    post,
    path = "/me/push-tokens",
    tag = "settings",
    security(("bearer" = [])),
    request_body = RegisterPushTokenRequest,
    responses(
        (status = 201, description = "Appareil enregistré", body = PushRegistration),
        (status = 400, description = "Jeton invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Compte introuvable", body = ErrorResponse),
    ),
)]
#[post("/me/push-tokens")]
async fn register_push_token(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    body: web::Json<RegisterPushTokenRequest>,
) -> Result<HttpResponse, ApiError> {
    let RegisterPushTokenRequest { token, platform } = body.into_inner();
    let token = token.trim();
    if !is_valid_token(token) {
        return Err(ApiError::Validation(vec![(
            "token",
            "Le jeton doit avoir la forme ExponentPushToken[...].".to_string(),
        )]));
    }
    let registered = state
        .store
        .register_push_token(claims.sub, token, platform)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Created().json(PushRegistration::from(registered)))
}

/// Révoque un appareil du compte (à la déconnexion, par exemple).
#[utoipa::path(
    delete,
    path = "/me/push-tokens",
    tag = "settings",
    security(("bearer" = [])),
    request_body = RevokePushTokenRequest,
    responses(
        (status = 204, description = "Appareil révoqué"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Aucun appareil de ce compte avec ce jeton", body = ErrorResponse),
    ),
)]
#[delete("/me/push-tokens")]
async fn revoke_push_token(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    body: web::Json<RevokePushTokenRequest>,
) -> Result<HttpResponse, ApiError> {
    if state
        .store
        .revoke_push_token(claims.sub, body.token.trim())
        .await
        .map_err(ApiError::internal)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}
