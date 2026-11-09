//! Consultation et administration des jeux.
//!
//! Toutes ces routes exigent un jeton d'accès (`guard::route_policy`) ; la création, la
//! modification et la suppression sont réservées aux administrateurs.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::store::{Game, GameInput, GameUpdate, StoreError};
use crate::users::require_admin;
use actix_web::{HttpResponse, delete, get, patch, post, web};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

const DEFAULT_PAGE_SIZE: i64 = 50;
const MAX_PAGE_SIZE: i64 = 100;
const NAME_MAX: usize = 64;
const DESCRIPTION_MAX: usize = 2000;
const IMAGES_MAX: usize = 10;
const IMAGE_URL_MAX: usize = 2048;

/// Routes des jeux, avec leur documentation OpenAPI.
pub fn routes(cfg: &mut ServiceConfig) {
    // `/games/export` et `/games/import` avant `/games/{id}`.
    cfg.service(crate::game_io::export_games)
        .service(crate::game_io::import_games)
        .service(list_games)
        .service(get_game)
        .service(create_game)
        .service(update_game)
        .service(delete_game);
}

#[derive(Deserialize, ToSchema)]
struct CreateGameRequest {
    #[schema(min_length = 1, max_length = 64, example = "Valorant")]
    name: String,
    #[schema(max_length = 2000)]
    description: Option<String>,
    /// URLs `http(s)` des images (10 au maximum).
    images: Option<Vec<String>>,
}

/// Champs modifiables, tous facultatifs.
#[derive(Deserialize, ToSchema)]
struct UpdateGameRequest {
    #[schema(min_length = 1, max_length = 64)]
    name: Option<String>,
    #[schema(max_length = 2000)]
    description: Option<String>,
    images: Option<Vec<String>>,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct Pagination {
    /// Nombre de jeux renvoyés (1 à 100, 50 par défaut).
    limit: Option<i64>,
    /// Nombre de jeux ignorés (0 par défaut).
    offset: Option<i64>,
}

/// Liste des jeux.
#[utoipa::path(
    get,
    path = "/games",
    tag = "games",
    security(("bearer" = [])),
    params(Pagination),
    responses(
        (status = 200, description = "Jeux, par ordre alphabétique", body = Vec<Game>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
    ),
)]
#[get("/games")]
async fn list_games(
    state: web::Data<AppState>,
    page: web::Query<Pagination>,
) -> Result<HttpResponse, ApiError> {
    let limit = page
        .limit
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let offset = page.offset.unwrap_or(0).max(0);
    let games = state
        .store
        .list_games(limit, offset)
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok().json(games))
}

/// Détail d'un jeu.
#[utoipa::path(
    get,
    path = "/games/{id}",
    tag = "games",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du jeu")),
    responses(
        (status = 200, description = "Le jeu", body = Game),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Jeu introuvable", body = ErrorResponse),
    ),
)]
#[get("/games/{id}")]
async fn get_game(
    state: web::Data<AppState>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let game = state
        .store
        .find_game(id.into_inner())
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(game))
}

/// Crée un jeu (administrateur).
#[utoipa::path(
    post,
    path = "/games",
    tag = "games",
    security(("bearer" = [])),
    request_body = CreateGameRequest,
    responses(
        (status = 201, description = "Jeu créé", body = Game),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 409, description = "Nom de jeu déjà pris", body = ErrorResponse),
    ),
)]
#[post("/games")]
async fn create_game(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    body: web::Json<CreateGameRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let CreateGameRequest {
        name,
        description,
        images,
    } = body.into_inner();
    let name = name.trim().to_string();
    let errors = validate(Some(&name), description.as_deref(), images.as_deref());
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    let game = state
        .store
        .create_game(GameInput {
            name,
            description: description.unwrap_or_default(),
            images: images.unwrap_or_default(),
        })
        .await
        .map_err(store_error)?;
    Ok(HttpResponse::Created().json(game))
}

/// Modifie un jeu (administrateur).
#[utoipa::path(
    patch,
    path = "/games/{id}",
    tag = "games",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du jeu")),
    request_body = UpdateGameRequest,
    responses(
        (status = 200, description = "Jeu modifié", body = Game),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Jeu introuvable", body = ErrorResponse),
        (status = 409, description = "Nom de jeu déjà pris", body = ErrorResponse),
    ),
)]
#[patch("/games/{id}")]
async fn update_game(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<UpdateGameRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let UpdateGameRequest {
        name,
        description,
        images,
    } = body.into_inner();
    if name.is_none() && description.is_none() && images.is_none() {
        return Err(ApiError::Validation(vec![(
            "body",
            "Renseignez au moins un champ à modifier.".to_string(),
        )]));
    }
    let name = name.map(|name| name.trim().to_string());
    let errors = validate(name.as_deref(), description.as_deref(), images.as_deref());
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    let game = state
        .store
        .update_game(
            id.into_inner(),
            GameUpdate {
                name,
                description,
                images,
            },
        )
        .await
        .map_err(store_error)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(game))
}

/// Supprime un jeu (administrateur).
#[utoipa::path(
    delete,
    path = "/games/{id}",
    tag = "games",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du jeu")),
    responses(
        (status = 204, description = "Jeu supprimé"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Jeu introuvable", body = ErrorResponse),
    ),
)]
#[delete("/games/{id}")]
async fn delete_game(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    if state
        .store
        .delete_game(id.into_inner())
        .await
        .map_err(ApiError::internal)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

fn store_error(err: StoreError) -> ApiError {
    match err {
        StoreError::GameNameTaken => ApiError::GameNameTaken,
        other => ApiError::internal(other),
    }
}

/// Messages d'erreur par champ pour les valeurs renseignées (`name` déjà nettoyé).
pub(crate) fn validate(
    name: Option<&str>,
    description: Option<&str>,
    images: Option<&[String]>,
) -> Vec<(&'static str, String)> {
    let mut errors = Vec::new();
    if let Some(name) = name
        && !(1..=NAME_MAX).contains(&name.chars().count())
    {
        errors.push((
            "name",
            format!("Le nom doit contenir entre 1 et {NAME_MAX} caractères."),
        ));
    }
    if let Some(description) = description
        && description.chars().count() > DESCRIPTION_MAX
    {
        errors.push((
            "description",
            format!("La description ne doit pas dépasser {DESCRIPTION_MAX} caractères."),
        ));
    }
    if let Some(images) = images {
        if images.len() > IMAGES_MAX {
            errors.push(("images", format!("{IMAGES_MAX} images au maximum.")));
        } else if !images.iter().all(|url| is_image_url(url)) {
            errors.push((
                "images",
                format!(
                    "Chaque image doit être une URL http(s) de {IMAGE_URL_MAX} caractères au maximum."
                ),
            ));
        }
    }
    errors
}

fn is_image_url(url: &str) -> bool {
    url.len() <= IMAGE_URL_MAX
        && ["http://", "https://"].iter().any(|scheme| {
            url.get(..scheme.len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(scheme))
                && url.len() > scheme.len()
        })
        && !url.chars().any(char::is_whitespace)
}
