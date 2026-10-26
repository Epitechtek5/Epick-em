//! Équipes globales (liées à un jeu, au-delà d'un tournoi) et leurs membres.
//!
//! Toutes ces routes exigent un jeton d'accès (`guard::route_policy`). Tout compte peut créer une
//! équipe et en devient le propriétaire ; seul le propriétaire peut la modifier, la supprimer ou
//! gérer ses membres.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::games::is_image_url;
use crate::store::{StoreError, Team, TeamInput, TeamMember, TeamRole, TeamUpdate};
use actix_web::{HttpResponse, delete, get, patch, post, web};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

pub(crate) const DEFAULT_PAGE_SIZE: i64 = 50;
pub(crate) const MAX_PAGE_SIZE: i64 = 100;
const NAME_MAX: usize = 64;
const TAG_MAX: usize = 8;

/// Routes des équipes globales, avec leur documentation OpenAPI.
pub fn routes(cfg: &mut ServiceConfig) {
    // `/teams/export` et `/teams/import` avant `/teams/{id}`.
    cfg.service(crate::team_io::export_teams)
        .service(crate::team_io::import_teams)
        .service(list_teams)
        .service(get_team)
        .service(create_team)
        .service(update_team)
        .service(delete_team)
        .service(list_members)
        .service(add_member)
        .service(update_member)
        .service(remove_member);
}

#[derive(Deserialize, ToSchema)]
struct CreateTeamRequest {
    /// Jeu de l'équipe.
    game_id: Uuid,
    #[schema(min_length = 1, max_length = 64, example = "Karmine Corp")]
    name: String,
    #[schema(max_length = 8, example = "KC")]
    tag: Option<String>,
    /// URL `http(s)` de la photo de profil.
    picture_url: Option<String>,
}

/// Champs modifiables, tous facultatifs ; une chaîne vide efface `tag` ou `picture_url`.
#[derive(Deserialize, ToSchema)]
struct UpdateTeamRequest {
    #[schema(min_length = 1, max_length = 64)]
    name: Option<String>,
    #[schema(max_length = 8)]
    tag: Option<String>,
    picture_url: Option<String>,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub(crate) struct Pagination {
    /// Nombre d'équipes renvoyées (1 à 100, 50 par défaut).
    limit: Option<i64>,
    /// Nombre d'équipes ignorées (0 par défaut).
    offset: Option<i64>,
}

impl Pagination {
    pub(crate) fn bounds(&self) -> (i64, i64) {
        (
            self.limit
                .unwrap_or(DEFAULT_PAGE_SIZE)
                .clamp(1, MAX_PAGE_SIZE),
            self.offset.unwrap_or(0).max(0),
        )
    }
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct TeamsQuery {
    /// Ne renvoie que les équipes de ce jeu.
    game_id: Option<Uuid>,
    limit: Option<i64>,
    offset: Option<i64>,
}

/// Compte à ajouter à une équipe, avec son rôle (`member` ou `substitute`).
#[derive(Deserialize, ToSchema)]
pub(crate) struct AddMemberRequest {
    pub(crate) user_id: Uuid,
    pub(crate) role: TeamRole,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct UpdateMemberRequest {
    pub(crate) role: TeamRole,
}

/// Liste des équipes globales.
#[utoipa::path(
    get,
    path = "/teams",
    tag = "teams",
    security(("bearer" = [])),
    params(TeamsQuery),
    responses(
        (status = 200, description = "Équipes, par ordre alphabétique", body = Vec<Team>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
    ),
)]
#[get("/teams")]
async fn list_teams(
    state: web::Data<AppState>,
    query: web::Query<TeamsQuery>,
) -> Result<HttpResponse, ApiError> {
    let (limit, offset) = Pagination {
        limit: query.limit,
        offset: query.offset,
    }
    .bounds();
    let teams = state
        .store
        .list_teams(query.game_id, limit, offset)
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok().json(teams))
}

/// Détail d'une équipe globale.
#[utoipa::path(
    get,
    path = "/teams/{id}",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de l'équipe")),
    responses(
        (status = 200, description = "L'équipe", body = Team),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Équipe introuvable", body = ErrorResponse),
    ),
)]
#[get("/teams/{id}")]
async fn get_team(
    state: web::Data<AppState>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    Ok(HttpResponse::Ok().json(find_team(&state, id.into_inner()).await?))
}

/// Crée une équipe ; l'appelant en devient le propriétaire et le premier membre.
#[utoipa::path(
    post,
    path = "/teams",
    tag = "teams",
    security(("bearer" = [])),
    request_body = CreateTeamRequest,
    responses(
        (status = 201, description = "Équipe créée", body = Team),
        (status = 400, description = "Requête invalide ou jeu introuvable", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 409, description = "Nom déjà pris pour ce jeu", body = ErrorResponse),
    ),
)]
#[post("/teams")]
async fn create_team(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    body: web::Json<CreateTeamRequest>,
) -> Result<HttpResponse, ApiError> {
    let CreateTeamRequest {
        game_id,
        name,
        tag,
        picture_url,
    } = body.into_inner();
    let name = name.trim().to_string();
    let tag = tag
        .map(|tag| tag.trim().to_string())
        .filter(|t| !t.is_empty());
    let picture_url = picture_url
        .map(|url| url.trim().to_string())
        .filter(|u| !u.is_empty());
    let errors = validate(Some(&name), tag.as_deref(), picture_url.as_deref());
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    if state
        .store
        .find_game(game_id)
        .await
        .map_err(ApiError::internal)?
        .is_none()
    {
        return Err(ApiError::Validation(vec![(
            "game_id",
            "Jeu introuvable.".to_string(),
        )]));
    }
    let team = state
        .store
        .create_team(TeamInput {
            game_id,
            name,
            tag,
            picture_url,
            owner_id: claims.sub,
        })
        .await
        .map_err(store_error)?;
    Ok(HttpResponse::Created().json(team))
}

/// Modifie une équipe (propriétaire).
#[utoipa::path(
    patch,
    path = "/teams/{id}",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de l'équipe")),
    request_body = UpdateTeamRequest,
    responses(
        (status = 200, description = "Équipe modifiée", body = Team),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé au propriétaire", body = ErrorResponse),
        (status = 404, description = "Équipe introuvable", body = ErrorResponse),
        (status = 409, description = "Nom déjà pris pour ce jeu", body = ErrorResponse),
    ),
)]
#[patch("/teams/{id}")]
async fn update_team(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<UpdateTeamRequest>,
) -> Result<HttpResponse, ApiError> {
    let team = find_team(&state, id.into_inner()).await?;
    require_owner(&claims, team.owner_id)?;
    let update = team_update(body.into_inner())?;
    let team = state
        .store
        .update_team(team.id, update)
        .await
        .map_err(store_error)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(team))
}

/// Supprime une équipe et ses membres (propriétaire). Les équipes de tournoi copiées depuis
/// celle-ci sont conservées.
#[utoipa::path(
    delete,
    path = "/teams/{id}",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de l'équipe")),
    responses(
        (status = 204, description = "Équipe supprimée"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé au propriétaire", body = ErrorResponse),
        (status = 404, description = "Équipe introuvable", body = ErrorResponse),
    ),
)]
#[delete("/teams/{id}")]
async fn delete_team(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let team = find_team(&state, id.into_inner()).await?;
    require_owner(&claims, team.owner_id)?;
    if state
        .store
        .delete_team(team.id)
        .await
        .map_err(ApiError::internal)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

/// Membres d'une équipe, actuels et anciens (`left_at` renseigné).
#[utoipa::path(
    get,
    path = "/teams/{id}/members",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de l'équipe")),
    responses(
        (status = 200, description = "Membres, par date d'arrivée", body = Vec<TeamMember>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Équipe introuvable", body = ErrorResponse),
    ),
)]
#[get("/teams/{id}/members")]
async fn list_members(
    state: web::Data<AppState>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let members = state
        .store
        .list_team_members(id.into_inner())
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(members))
}

/// Ajoute un compte à l'équipe (propriétaire). Le rôle `owner` n'est pas attribuable.
#[utoipa::path(
    post,
    path = "/teams/{id}/members",
    tag = "teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de l'équipe")),
    request_body = AddMemberRequest,
    responses(
        (status = 201, description = "Membre ajouté", body = TeamMember),
        (status = 400, description = "Requête invalide ou compte introuvable", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé au propriétaire", body = ErrorResponse),
        (status = 404, description = "Équipe introuvable", body = ErrorResponse),
        (status = 409, description = "Déjà membre de l'équipe", body = ErrorResponse),
    ),
)]
#[post("/teams/{id}/members")]
async fn add_member(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<AddMemberRequest>,
) -> Result<HttpResponse, ApiError> {
    let team = find_team(&state, id.into_inner()).await?;
    require_owner(&claims, team.owner_id)?;
    let AddMemberRequest { user_id, role } = body.into_inner();
    require_assignable(role)?;
    let member = state
        .store
        .add_team_member(team.id, user_id, role)
        .await
        .map_err(store_error)?
        .ok_or_else(|| ApiError::Validation(vec![("user_id", "Compte introuvable.".into())]))?;
    Ok(HttpResponse::Created().json(member))
}

/// Change le rôle d'un membre actif (propriétaire). Le rôle du propriétaire est fixe.
#[utoipa::path(
    patch,
    path = "/teams/{id}/members/{user_id}",
    tag = "teams",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant de l'équipe"),
        ("user_id" = Uuid, Path, description = "Identifiant du compte"),
    ),
    request_body = UpdateMemberRequest,
    responses(
        (status = 200, description = "Rôle modifié", body = TeamMember),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé au propriétaire", body = ErrorResponse),
        (status = 404, description = "Équipe ou membre introuvable", body = ErrorResponse),
    ),
)]
#[patch("/teams/{id}/members/{user_id}")]
async fn update_member(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
    body: web::Json<UpdateMemberRequest>,
) -> Result<HttpResponse, ApiError> {
    let (id, user_id) = path.into_inner();
    let team = find_team(&state, id).await?;
    require_owner(&claims, team.owner_id)?;
    require_assignable(body.role)?;
    if user_id == team.owner_id {
        return Err(owner_is_fixed());
    }
    let member = state
        .store
        .set_team_member_role(team.id, user_id, body.role)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(member))
}

/// Retire un membre de l'équipe (propriétaire) : il est conservé dans l'historique avec
/// `left_at`. Le propriétaire ne peut pas être retiré.
#[utoipa::path(
    delete,
    path = "/teams/{id}/members/{user_id}",
    tag = "teams",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant de l'équipe"),
        ("user_id" = Uuid, Path, description = "Identifiant du compte"),
    ),
    responses(
        (status = 204, description = "Membre retiré"),
        (status = 400, description = "Le propriétaire ne peut pas être retiré", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé au propriétaire", body = ErrorResponse),
        (status = 404, description = "Équipe ou membre introuvable", body = ErrorResponse),
    ),
)]
#[delete("/teams/{id}/members/{user_id}")]
async fn remove_member(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (id, user_id) = path.into_inner();
    let team = find_team(&state, id).await?;
    require_owner(&claims, team.owner_id)?;
    if user_id == team.owner_id {
        return Err(owner_is_fixed());
    }
    if state
        .store
        .remove_team_member(team.id, user_id)
        .await
        .map_err(ApiError::internal)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

async fn find_team(state: &AppState, id: Uuid) -> Result<Team, ApiError> {
    state
        .store
        .find_team(id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)
}

/// Seul le propriétaire agit sur son équipe, administrateur compris.
pub(crate) fn require_owner(claims: &Claims, owner_id: Uuid) -> Result<(), ApiError> {
    if claims.sub == owner_id {
        Ok(())
    } else {
        Err(ApiError::Forbidden)
    }
}

/// Le rôle `owner` appartient au propriétaire de l'équipe : il ne s'attribue pas.
pub(crate) fn require_assignable(role: TeamRole) -> Result<(), ApiError> {
    if role == TeamRole::Owner {
        Err(ApiError::Validation(vec![(
            "role",
            "Le rôle `owner` n'est pas attribuable : choisissez `member` ou `substitute`."
                .to_string(),
        )]))
    } else {
        Ok(())
    }
}

pub(crate) fn owner_is_fixed() -> ApiError {
    ApiError::Validation(vec![(
        "user_id",
        "Le propriétaire ne peut ni changer de rôle ni quitter l'équipe.".to_string(),
    )])
}

/// Modification partielle validée : une chaîne vide efface `tag` et `picture_url`.
pub(crate) fn team_update_parts(
    name: Option<String>,
    tag: Option<String>,
    picture_url: Option<String>,
) -> Result<TeamUpdate, ApiError> {
    if name.is_none() && tag.is_none() && picture_url.is_none() {
        return Err(ApiError::Validation(vec![(
            "body",
            "Renseignez au moins un champ à modifier.".to_string(),
        )]));
    }
    let name = name.map(|name| name.trim().to_string());
    let clearable = |value: Option<String>| {
        value.map(|value| Some(value.trim().to_string()).filter(|v| !v.is_empty()))
    };
    let (tag, picture_url) = (clearable(tag), clearable(picture_url));
    let errors = validate(
        name.as_deref(),
        tag.as_ref().and_then(|t| t.as_deref()),
        picture_url.as_ref().and_then(|u| u.as_deref()),
    );
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    Ok(TeamUpdate {
        name,
        tag,
        picture_url,
    })
}

fn team_update(request: UpdateTeamRequest) -> Result<TeamUpdate, ApiError> {
    team_update_parts(request.name, request.tag, request.picture_url)
}

fn store_error(err: StoreError) -> ApiError {
    match err {
        StoreError::TeamNameTaken => ApiError::TeamNameTaken,
        StoreError::AlreadyTeamMember => ApiError::AlreadyTeamMember,
        other => ApiError::internal(other),
    }
}

/// Messages d'erreur par champ pour les valeurs renseignées (déjà nettoyées).
pub(crate) fn validate(
    name: Option<&str>,
    tag: Option<&str>,
    picture_url: Option<&str>,
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
    if let Some(tag) = tag
        && !(1..=TAG_MAX).contains(&tag.chars().count())
    {
        errors.push((
            "tag",
            format!("Le tag doit contenir entre 1 et {TAG_MAX} caractères."),
        ));
    }
    if let Some(url) = picture_url
        && !is_image_url(url)
    {
        errors.push((
            "picture_url",
            "La photo doit être une URL http(s) de 2048 caractères au maximum.".to_string(),
        ));
    }
    errors
}
