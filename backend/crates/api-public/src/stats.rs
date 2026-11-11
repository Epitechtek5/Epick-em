//! Consultation et administration des statistiques, et leur liaison aux jeux.
//!
//! Toutes ces routes exigent un jeton d'accès (`guard::route_policy`) ; la création, la
//! modification, la suppression et la liaison sont réservées aux administrateurs.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::store::{Stat, StatInput, StatOption, StatScope, StatType, StatUpdate, StoreError};
use crate::users::require_admin;
use actix_web::{HttpResponse, delete, get, patch, post, put, web};
use serde::Deserialize;
use std::collections::HashSet;
use utoipa::{IntoParams, ToSchema};
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

const DEFAULT_PAGE_SIZE: i64 = 50;
const MAX_PAGE_SIZE: i64 = 100;
const NAME_MAX: usize = 64;
const KEY_MAX: usize = 64;
const OPTIONS_MAX: usize = 500;

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
        .service(list_stat_options)
        .service(set_stat_options)
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
    /// `flat` (valeur brute), `percent` (pourcentage), `select` (choix parmi les options du jeu)
    /// ou `mvp` (participant ou joueur désigné meilleur joueur de la partie).
    #[serde(rename = "type")]
    kind: StatType,
    /// `participant` (une valeur par participant) ou `match` (attribut de la partie : carte,
    /// MVP...). `participant` par défaut, `match` pour `mvp` ; `flat` et `percent` sont
    /// toujours `participant`, `mvp` toujours `match`.
    scope: Option<StatScope>,
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
    /// Modifiable pour une statistique `select` seulement.
    scope: Option<StatScope>,
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
    let CreateStatRequest {
        name,
        key,
        kind,
        scope,
    } = body.into_inner();
    let name = name.trim().to_string();
    let key = key.trim().to_string();
    let mut errors = validate(Some(&name), Some(&key));
    let scope = scope.unwrap_or(default_scope(kind));
    errors.extend(check_scope(kind, scope));
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    let stat = state
        .store
        .create_stat(StatInput {
            name,
            key,
            kind,
            scope,
        })
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
    let UpdateStatRequest {
        name,
        key,
        kind,
        scope,
    } = body.into_inner();
    if name.is_none() && key.is_none() && kind.is_none() && scope.is_none() {
        return Err(ApiError::Validation(vec![(
            "body",
            "Renseignez au moins un champ à modifier.".to_string(),
        )]));
    }
    let name = name.map(|name| name.trim().to_string());
    let key = key.map(|key| key.trim().to_string());
    let mut errors = validate(name.as_deref(), key.as_deref());
    let id = id.into_inner();
    let mut new_scope = None;
    if kind.is_some() || scope.is_some() {
        let current = state
            .store
            .find_stat(id)
            .await
            .map_err(ApiError::internal)?
            .ok_or(ApiError::NotFound)?;
        let new_kind = kind.unwrap_or(current.kind);
        if new_kind.is_numeric() != current.kind.is_numeric() {
            errors.push((
                "type",
                "Une statistique numérique (`flat`, `percent`) ne devient pas `select` ou `mvp`, ni l'inverse : créez-en une autre."
                    .to_string(),
            ));
        }
        let wanted = scope.unwrap_or(if new_kind == current.kind {
            current.scope
        } else {
            default_scope(new_kind)
        });
        errors.extend(check_scope(new_kind, wanted));
        new_scope = Some(wanted);
    }
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    let stat = state
        .store
        .update_stat(
            id,
            StatUpdate {
                name,
                key,
                kind,
                scope: new_scope,
            },
        )
        .await
        .map_err(store_error)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(stat))
}

fn default_scope(kind: StatType) -> StatScope {
    if kind == StatType::Mvp {
        StatScope::Match
    } else {
        StatScope::Participant
    }
}

/// Une statistique numérique est toujours de portée `participant`, un MVP toujours de portée
/// `match` ; une statistique `select` est de l'une ou l'autre.
pub(crate) fn check_scope(kind: StatType, scope: StatScope) -> Vec<(&'static str, String)> {
    let valid = match kind {
        StatType::Flat | StatType::Percent => scope == StatScope::Participant,
        StatType::Select => true,
        StatType::Mvp => scope == StatScope::Match,
    };
    if valid {
        return Vec::new();
    }
    vec![(
        "scope",
        format!(
            "Une statistique `{}` est de portée `{}`.",
            kind.as_str(),
            default_scope(kind).as_str()
        ),
    )]
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

/// Options d'une statistique `select` pour un jeu.
#[derive(Deserialize, ToSchema)]
struct OptionsRequest {
    /// Remplace toutes les options du jeu, dans l'ordre d'affichage.
    options: Vec<StatOption>,
}

/// Options d'une statistique `select` pour un jeu, dans l'ordre d'affichage.
#[utoipa::path(
    get,
    path = "/games/{game_id}/stats/{stat_id}/options",
    tag = "stats",
    security(("bearer" = [])),
    params(
        ("game_id" = Uuid, Path, description = "Identifiant du jeu"),
        ("stat_id" = Uuid, Path, description = "Identifiant de la statistique"),
    ),
    responses(
        (status = 200, description = "Options autorisées pour le jeu", body = Vec<StatOption>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Jeu introuvable ou statistique non liée à ce jeu", body = ErrorResponse),
    ),
)]
#[get("/games/{game_id}/stats/{stat_id}/options")]
async fn list_stat_options(
    state: web::Data<AppState>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (game_id, stat_id) = path.into_inner();
    let stat = state
        .store
        .list_game_stats(game_id)
        .await
        .map_err(ApiError::internal)?
        .and_then(|stats| stats.into_iter().find(|s| s.id == stat_id))
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(stat.options))
}

/// Remplace les options d'une statistique `select` pour un jeu (administrateur).
///
/// Chaque option a une clé stable (slug, identifiant stocké dans les résultats) et un libellé.
/// Les résultats déjà saisis gardent leur clé ; une clé retirée n'est plus acceptée pour de
/// nouveaux résultats.
#[utoipa::path(
    put,
    path = "/games/{game_id}/stats/{stat_id}/options",
    tag = "stats",
    security(("bearer" = [])),
    params(
        ("game_id" = Uuid, Path, description = "Identifiant du jeu"),
        ("stat_id" = Uuid, Path, description = "Identifiant de la statistique"),
    ),
    request_body = OptionsRequest,
    responses(
        (status = 200, description = "Options enregistrées", body = Vec<StatOption>),
        (status = 400, description = "Options invalides ou statistique qui n'est pas de type `select`", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Jeu introuvable ou statistique non liée à ce jeu", body = ErrorResponse),
    ),
)]
#[put("/games/{game_id}/stats/{stat_id}/options")]
async fn set_stat_options(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
    body: web::Json<OptionsRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (game_id, stat_id) = path.into_inner();
    let stat = state
        .store
        .list_game_stats(game_id)
        .await
        .map_err(ApiError::internal)?
        .and_then(|stats| stats.into_iter().find(|s| s.id == stat_id))
        .ok_or(ApiError::NotFound)?;
    if stat.kind != StatType::Select {
        return Err(ApiError::Validation(vec![(
            "options",
            "Seule une statistique de type `select` a des options.".to_string(),
        )]));
    }
    let options: Vec<StatOption> = body
        .into_inner()
        .options
        .into_iter()
        .map(|o| StatOption {
            key: o.key.trim().to_string(),
            label: o.label.trim().to_string(),
        })
        .collect();
    if let Some(problem) = check_options(&options) {
        return Err(ApiError::Validation(vec![("options", problem)]));
    }
    if !state
        .store
        .set_stat_options(game_id, stat_id, options.clone())
        .await
        .map_err(ApiError::internal)?
    {
        return Err(ApiError::NotFound);
    }
    Ok(HttpResponse::Ok().json(options))
}

/// Ce qui ne va pas dans une liste d'options (déjà nettoyées), ou `None`.
pub(crate) fn check_options(options: &[StatOption]) -> Option<String> {
    if options.len() > OPTIONS_MAX {
        return Some(format!("{OPTIONS_MAX} options au plus."));
    }
    let mut keys = HashSet::new();
    for (index, option) in options.iter().enumerate() {
        let position = index + 1;
        if !is_slug(&option.key) {
            return Some(format!(
                "option {position} : la clé doit être un slug de {KEY_MAX} caractères au maximum (minuscules, chiffres et `_`)."
            ));
        }
        if !(1..=NAME_MAX).contains(&option.label.chars().count()) {
            return Some(format!(
                "option {position} : le libellé doit contenir entre 1 et {NAME_MAX} caractères."
            ));
        }
        if !keys.insert(option.key.as_str()) {
            return Some(format!(
                "option {position} : la clé `{}` apparaît plusieurs fois.",
                option.key
            ));
        }
    }
    None
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
    fn scope_follows_the_type() {
        use StatScope::{Match, Participant};
        assert!(check_scope(StatType::Flat, Participant).is_empty());
        assert!(!check_scope(StatType::Percent, Match).is_empty());
        assert!(check_scope(StatType::Select, Participant).is_empty());
        assert!(check_scope(StatType::Select, Match).is_empty());
        assert!(check_scope(StatType::Mvp, Match).is_empty());
        assert!(!check_scope(StatType::Mvp, Participant).is_empty());
        assert_eq!(default_scope(StatType::Mvp), Match);
        assert_eq!(default_scope(StatType::Select), Participant);
    }

    #[test]
    fn options_need_unique_slugs_and_labels() {
        let option = |key: &str, label: &str| StatOption {
            key: key.into(),
            label: label.into(),
        };
        assert!(check_options(&[option("jett", "Jett"), option("omen", "Omen")]).is_none());
        assert!(check_options(&[]).is_none());
        assert!(check_options(&[option("Jett", "Jett")]).is_some());
        assert!(check_options(&[option("jett", "")]).is_some());
        assert!(check_options(&[option("jett", "A"), option("jett", "B")]).is_some());
    }

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
