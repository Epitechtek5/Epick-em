//! Consultation, modification et suppression des comptes.
//!
//! Toutes ces routes exigent un jeton d'accès (`guard::route_policy`). Les modifications d'un
//! autre compte sont réservées aux administrateurs ; chacun peut modifier ou supprimer le sien
//! (`/me/*`), sauf son rôle.

use crate::auth::{AppState, Claims, hash_password_blocking, password_error, username_error};
use crate::error::{ApiError, ErrorResponse};
use crate::store::{Role, StoreError, UserProfile, UserUpdate};
use actix_web::{HttpResponse, delete, get, patch, web};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

const DEFAULT_PAGE_SIZE: i64 = 50;
const MAX_PAGE_SIZE: i64 = 100;

/// Routes des comptes, avec leur documentation OpenAPI.
pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(list_users)
        .service(get_user)
        .service(update_user)
        .service(delete_user)
        .service(update_me)
        .service(delete_me);
}

/// Champs modifiables, tous facultatifs. `role` est réservé aux administrateurs.
#[derive(Deserialize, ToSchema)]
struct UpdateUserRequest {
    #[schema(min_length = 3, max_length = 32, example = "alice")]
    username: Option<String>,
    #[schema(min_length = 8, max_length = 128, format = Password)]
    password: Option<String>,
    role: Option<Role>,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct Pagination {
    /// Nombre de comptes renvoyés (1 à 100, 50 par défaut).
    limit: Option<i64>,
    /// Nombre de comptes ignorés (0 par défaut).
    offset: Option<i64>,
}

/// Liste des comptes.
#[utoipa::path(
    get,
    path = "/users",
    tag = "users",
    security(("bearer" = [])),
    params(Pagination),
    responses(
        (status = 200, description = "Comptes, du plus ancien au plus récent", body = Vec<UserProfile>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
    ),
)]
#[get("/users")]
async fn list_users(
    state: web::Data<AppState>,
    page: web::Query<Pagination>,
) -> Result<HttpResponse, ApiError> {
    let limit = page
        .limit
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let offset = page.offset.unwrap_or(0).max(0);
    let users = state
        .store
        .list_profiles(limit, offset)
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok().json(users))
}

/// Profil d'un compte.
#[utoipa::path(
    get,
    path = "/user/{id}",
    tag = "users",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du compte")),
    responses(
        (status = 200, description = "Profil du compte", body = UserProfile),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Compte introuvable", body = ErrorResponse),
    ),
)]
#[get("/user/{id}")]
async fn get_user(
    state: web::Data<AppState>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let user = state
        .store
        .find_profile(id.into_inner())
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(user))
}

/// Modifie un compte (administrateur).
#[utoipa::path(
    patch,
    path = "/user/{id}/update",
    tag = "users",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du compte")),
    request_body = UpdateUserRequest,
    responses(
        (status = 200, description = "Compte modifié", body = UserProfile),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Compte introuvable", body = ErrorResponse),
        (status = 409, description = "Nom d'utilisateur déjà pris", body = ErrorResponse),
    ),
)]
#[patch("/user/{id}/update")]
async fn update_user(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<UpdateUserRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let user = update(&state, id.into_inner(), body.into_inner()).await?;
    Ok(HttpResponse::Ok().json(user))
}

/// Supprime un compte (administrateur).
#[utoipa::path(
    delete,
    path = "/user/{id}/delete",
    tag = "users",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du compte")),
    responses(
        (status = 204, description = "Compte supprimé"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Compte introuvable", body = ErrorResponse),
    ),
)]
#[delete("/user/{id}/delete")]
async fn delete_user(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    delete(&state, id.into_inner()).await?;
    Ok(HttpResponse::NoContent().finish())
}

/// Modifie son propre compte. Le rôle ne peut pas être changé ici.
#[utoipa::path(
    patch,
    path = "/me/update",
    tag = "users",
    security(("bearer" = [])),
    request_body = UpdateUserRequest,
    responses(
        (status = 200, description = "Compte modifié", body = UserProfile),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Le rôle n'est pas modifiable ici", body = ErrorResponse),
        (status = 404, description = "Compte introuvable", body = ErrorResponse),
        (status = 409, description = "Nom d'utilisateur déjà pris", body = ErrorResponse),
    ),
)]
#[patch("/me/update")]
async fn update_me(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    body: web::Json<UpdateUserRequest>,
) -> Result<HttpResponse, ApiError> {
    // Pas de changement de son propre rôle, administrateur compris : cela passe par
    // /user/{id}/update.
    if body.role.is_some() {
        return Err(ApiError::Forbidden);
    }
    let user = update(&state, claims.sub, body.into_inner()).await?;
    Ok(HttpResponse::Ok().json(user))
}

/// Supprime son propre compte et révoque ses jetons de rafraîchissement.
#[utoipa::path(
    delete,
    path = "/me/delete",
    tag = "users",
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Compte supprimé"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Compte introuvable", body = ErrorResponse),
    ),
)]
#[delete("/me/delete")]
async fn delete_me(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
) -> Result<HttpResponse, ApiError> {
    delete(&state, claims.sub).await?;
    Ok(HttpResponse::NoContent().finish())
}

/// Le rôle du jeton peut dater d'au plus `ACCESS_TOKEN_TTL_SECS` (ADR-009) : pour une action
/// d'administration on relit le compte en base, hors cache (un `UPDATE` direct, comme la
/// désignation du premier administrateur, ne l'invalide pas), afin qu'un administrateur
/// rétrogradé ou supprimé perde ses droits tout de suite.
async fn require_admin(state: &AppState, claims: &Claims) -> Result<(), ApiError> {
    let user = state
        .store
        .find_user_by_id(claims.sub)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::Unauthorized)?;
    if user.role == Role::Admin {
        Ok(())
    } else {
        Err(ApiError::Forbidden)
    }
}

/// Applique une mise à jour partielle : seuls les champs fournis sont modifiés.
async fn update(
    state: &AppState,
    id: Uuid,
    request: UpdateUserRequest,
) -> Result<UserProfile, ApiError> {
    let UpdateUserRequest {
        username,
        password,
        role,
    } = request;
    if username.is_none() && password.is_none() && role.is_none() {
        return Err(ApiError::Validation(vec![(
            "body",
            "Renseignez au moins un champ à modifier.".to_string(),
        )]));
    }
    let mut errors = Vec::new();
    if let Some(message) = username.as_deref().and_then(username_error) {
        errors.push(("username", message));
    }
    if let Some(message) = password.as_deref().and_then(password_error) {
        errors.push(("password", message));
    }
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    let password_hash = match password {
        Some(password) => Some(hash_password_blocking(password).await?),
        None => None,
    };

    state
        .store
        .update_user(
            id,
            UserUpdate {
                username,
                password_hash,
                role,
            },
        )
        .await
        .map_err(|err| match err {
            StoreError::UsernameTaken => ApiError::Conflict,
            other => ApiError::internal(other),
        })?
        .ok_or(ApiError::NotFound)
}

async fn delete(state: &AppState, id: Uuid) -> Result<(), ApiError> {
    if state
        .store
        .delete_user(id)
        .await
        .map_err(ApiError::internal)?
    {
        Ok(())
    } else {
        Err(ApiError::NotFound)
    }
}
