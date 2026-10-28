//! Consultation et administration des statistiques, et leur liaison aux jeux.
//!
//! Toutes ces routes exigent un jeton d'accès (`guard::route_policy`) ; la création, la
//! modification, la suppression et la liaison sont réservées aux administrateurs.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::store::{Stat, StatInput, StatType, StatUpdate, StoreError};
use crate::users::require_admin;
use actix_web::{HttpResponse, delete, get, patch, post, put, web};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

const DEFAULT_PAGE_SIZE: i64 = 50;
const MAX_PAGE_SIZE: i64 = 100;
const NAME_MAX: usize = 64;
const KEY_MAX: usize = 64;

/// Routes des statistiques, avec leur documentation OpenAPI.
pub fn routes(cfg: &mut ServiceConfig) {
    // `/stats/export` et `/stats/import` avant `/stats/{id}`.
    cfg.service(crate::stat_io::export_stats)
        .service(crate::stat_io::import_stats)
        .service(list_stats)
        .service(get_stat)
        .service(create_stat)
        .service(update_stat)
        .service(delete_stat)
        .service(list_game_stats)
        .service(link_stat)
        .service(unlink_stat);
}

#[derive(Deserialize, ToSchema)]
struct CreateStatRequest {
    #[schema(min_length = 1, max_length = 64, example = "Éliminations")]
    name: String,
    /// Slug unique en minuscules, chiffres et `_` (ex. `kills`).
    #[schema(
        max_length = 64,
        pattern = "^[a-z0-9]+(_[a-z0-9]+)*$",
        example = "kills"
    )]
    key: String,
    /// `flat` (valeur brute) ou `percent` (pourcentage).
    #[serde(rename = "type")]
    kind: StatType,
}

/// Champs modifiables, tous facultatifs.
#[derive(Deserialize, ToSchema)]
struct UpdateStatRequest {
    #[schema(min_length = 1, max_length = 64)]
    name: Option<String>,
    #[schema(max_length = 64, pattern = "^[a-z0-9]+(_[a-z0-9]+)*$")]
    key: Option<String>,
    #[serde(rename = "type")]
    kind: Option<StatType>,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct Pagination {
    /// Nombre de statistiques renvoyées (1 à 100, 50 par défaut).
    limit: Option<i64>,
    /// Nombre de statistiques ignorées (0 par défaut).
    offset: Option<i64>,
}

/// Liste des statistiques.
#[utoipa::path(
    get,
    path = "/stats",
    tag = "stats",
    security(("bearer" = [])),
    params(Pagination),
    responses(
        (status = 200, description = "Statistiques, par ordre alphabétique", body = Vec<Stat>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
    ),
)]
#[get("/stats")]
async fn list_stats(
    state: web::Data<AppState>,
    page: web::Query<Pagination>,
) -> Result<HttpResponse, ApiError> {
    let limit = page
        .limit
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let offset = page.offset.unwrap_or(0).max(0);
    let stats = state
        .store
        .list_stats(limit, offset)
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok().json(stats))
}

/// Détail d'une statistique.
#[utoipa::path(
    get,
    path = "/stats/{id}",
    tag = "stats",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de la statistique")),
    responses(
        (status = 200, description = "La statistique", body = Stat),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Statistique introuvable", body = ErrorResponse),
    ),
)]
#[get("/stats/{id}")]
async fn get_stat(
    state: web::Data<AppState>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let stat = state
        .store
        .find_stat(id.into_inner())
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(stat))
}

/// Crée une statistique (administrateur).
#[utoipa::path(
    post,
    path = "/stats",
    tag = "stats",
    security(("bearer" = [])),
    request_body = CreateStatRequest,
    responses(
        (status = 201, description = "Statistique créée", body = Stat),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 409, description = "Clé déjà prise", body = ErrorResponse),
    ),
)]
#[post("/stats")]
async fn create_stat(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    body: web::Json<CreateStatRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let CreateStatRequest { name, key, kind } = body.into_inner();
    let name = name.trim().to_string();
    let key = key.trim().to_string();
    let errors = validate(Some(&name), Some(&key));
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    let stat = state
        .store
        .create_stat(StatInput { name, key, kind })
        .await
        .map_err(store_error)?;
    Ok(HttpResponse::Created().json(stat))
}

/// Modifie une statistique (administrateur).
#[utoipa::path(
    patch,
    path = "/stats/{id}",
    tag = "stats",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de la statistique")),
    request_body = UpdateStatRequest,
    responses(
        (status = 200, description = "Statistique modifiée", body = Stat),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Statistique introuvable", body = ErrorResponse),
        (status = 409, description = "Clé déjà prise", body = ErrorResponse),
    ),
)]
#[patch("/stats/{id}")]
async fn update_stat(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<UpdateStatRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let UpdateStatRequest { name, key, kind } = body.into_inner();
    if name.is_none() && key.is_none() && kind.is_none() {
        return Err(ApiError::Validation(vec![(
            "body",
            "Renseignez au moins un champ à modifier.".to_string(),
        )]));
    }
    let name = name.map(|name| name.trim().to_string());
    let key = key.map(|key| key.trim().to_string());
    let errors = validate(name.as_deref(), key.as_deref());
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    let stat = state
        .store
        .update_stat(id.into_inner(), StatUpdate { name, key, kind })
        .await
        .map_err(store_error)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(stat))
}

/// Supprime une statistique et ses liaisons aux jeux (administrateur).
///
/// Refusée tant que le barème d'un tournoi `ongoing` s'en sert.
#[utoipa::path(
    delete,
    path = "/stats/{id}",
    tag = "stats",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de la statistique")),
    responses(
        (status = 204, description = "Statistique supprimée"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Statistique introuvable", body = ErrorResponse),
        (status = 409, description = "Utilisée par un tournoi en cours", body = ErrorResponse),
    ),
)]
#[delete("/stats/{id}")]
async fn delete_stat(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    if state
        .store
        .delete_stat(id.into_inner())
        .await
        .map_err(store_error)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

/// Statistiques d'un jeu.
#[utoipa::path(
    get,
    path = "/games/{id}/stats",
    tag = "stats",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du jeu")),
    responses(
        (status = 200, description = "Statistiques liées au jeu, par ordre alphabétique", body = Vec<Stat>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Jeu introuvable", body = ErrorResponse),
    ),
)]
#[get("/games/{id}/stats")]
async fn list_game_stats(
    state: web::Data<AppState>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let stats = state
        .store
        .list_game_stats(id.into_inner())
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(stats))
}

/// Lie une statistique à un jeu (administrateur). Sans effet si elle l'est déjà.
#[utoipa::path(
    put,
    path = "/games/{game_id}/stats/{stat_id}",
    tag = "stats",
    security(("bearer" = [])),
    params(
        ("game_id" = Uuid, Path, description = "Identifiant du jeu"),
        ("stat_id" = Uuid, Path, description = "Identifiant de la statistique"),
    ),
    responses(
        (status = 204, description = "Statistique liée au jeu"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Jeu ou statistique introuvable", body = ErrorResponse),
    ),
)]
#[put("/games/{game_id}/stats/{stat_id}")]
async fn link_stat(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (game_id, stat_id) = path.into_inner();
    if state
        .store
        .link_stat(game_id, stat_id)
        .await
        .map_err(ApiError::internal)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

/// Délie une statistique d'un jeu (administrateur).
#[utoipa::path(
    delete,
    path = "/games/{game_id}/stats/{stat_id}",
    tag = "stats",
    security(("bearer" = [])),
    params(
        ("game_id" = Uuid, Path, description = "Identifiant du jeu"),
        ("stat_id" = Uuid, Path, description = "Identifiant de la statistique"),
    ),
    responses(
        (status = 204, description = "Statistique déliée du jeu"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Liaison introuvable", body = ErrorResponse),
    ),
)]
#[delete("/games/{game_id}/stats/{stat_id}")]
async fn unlink_stat(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (game_id, stat_id) = path.into_inner();
    if state
        .store
        .unlink_stat(game_id, stat_id)
        .await
        .map_err(store_error)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

fn store_error(err: StoreError) -> ApiError {
    match err {
        StoreError::StatKeyTaken => ApiError::StatKeyTaken,
        StoreError::StatInUse => ApiError::StatInUse,
        other => ApiError::internal(other),
    }
}

/// Messages d'erreur par champ pour les valeurs renseignées (déjà nettoyées).
pub(crate) fn validate(name: Option<&str>, key: Option<&str>) -> Vec<(&'static str, String)> {
    let mut errors = Vec::new();
    if let Some(name) = name
        && !(1..=NAME_MAX).contains(&name.chars().count())
    {
        errors.push((
            "name",
            format!("Le nom doit contenir entre 1 et {NAME_MAX} caractères."),
        ));
    }
    if let Some(key) = key
        && !is_slug(key)
    {
        errors.push((
            "key",
            format!(
                "La clé doit être un slug de {KEY_MAX} caractères au maximum : minuscules, chiffres et `_` (ex. `kills`)."
            ),
        ));
    }
    errors
}

/// Segments de minuscules et chiffres séparés par un seul `_` (`^[a-z0-9]+(_[a-z0-9]+)*$`).
fn is_slug(key: &str) -> bool {
    key.len() <= KEY_MAX
        && key.split('_').all(|segment| {
            !segment.is_empty()
                && segment
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs() {
        for ok in ["kills", "first_blood", "a1_b2", "x"] {
            assert!(is_slug(ok), "{ok}");
        }
        for bad in [
            "",
            "Kills",
            "_a",
            "a_",
            "a__b",
            "a b",
            "é",
            "a-b",
            &"a".repeat(65),
        ] {
            assert!(!is_slug(bad), "{bad}");
        }
    }
}
