//! Équipes de tournoi : créées pour un seul tournoi, de zéro ou par copie d'une équipe globale.
//!
//! Une copie est indépendante de l'équipe globale d'origine : nom, tag, photo, propriétaire et
//! membres sont recopiés à la création, puis plus rien n'est synchronisé dans un sens ni dans
//! l'autre. Seul le propriétaire de l'équipe de tournoi peut la modifier, la supprimer ou gérer
//! ses membres.
//!
//! Le tournoi doit exister, être en préparation ou en inscription (`draft` ou `registration`),
//! et l'équipe globale copiée doit être du jeu du tournoi.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::store::{
    StoreError, TeamRole, TeamUpdate, Tournament, TournamentStatus, TournamentTeam,
    TournamentTeamInput, TournamentTeamMember,
};
use crate::teams::{
    AddMemberRequest, Pagination, UpdateMemberRequest, owner_is_fixed, require_assignable,
    require_owner, team_update_parts, validate,
};
use actix_web::{HttpResponse, delete, get, patch, post, web};
use serde::Deserialize;
use std::collections::HashSet;
use utoipa::ToSchema;
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

/// Routes des équipes de tournoi, avec leur documentation OpenAPI.
pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(list_tournament_teams)
        .service(create_tournament_team)
        .service(get_tournament_team)
        .service(update_tournament_team)
        .service(delete_tournament_team)
        .service(list_members)
        .service(add_member)
        .service(update_member)
        .service(remove_member);
}

/// Inscription d'une équipe à un tournoi : soit par copie d'une équipe globale (`team_id`), soit
/// de zéro (`name`).
#[derive(Deserialize, ToSchema)]
struct CreateTournamentTeamRequest {
    /// Équipe globale à copier ; l'appelant doit en être le propriétaire. Exclut `name`, `tag`
    /// et `picture_url`.
    team_id: Option<Uuid>,
    /// Membres de l'équipe globale à copier (le propriétaire l'est toujours) ; tous les membres
    /// actifs par défaut. Ils doivent être membres actifs de l'équipe globale.
    member_ids: Option<Vec<Uuid>>,
    /// Nom de l'équipe créée de zéro ; l'appelant en est le propriétaire.
    #[schema(min_length = 1, max_length = 64)]
    name: Option<String>,
    #[schema(max_length = 8)]
    tag: Option<String>,
    picture_url: Option<String>,
}

/// Champs modifiables, tous facultatifs ; une chaîne vide efface `tag` ou `picture_url`.
#[derive(Deserialize, ToSchema)]
struct UpdateTournamentTeamRequest {
    #[schema(min_length = 1, max_length = 64)]
    name: Option<String>,
    #[schema(max_length = 8)]
    tag: Option<String>,
    picture_url: Option<String>,
}

/// Équipes d'un tournoi.
#[utoipa::path(
    get,
    path = "/tournaments/{tournament_id}/teams",
    tag = "tournament-teams",
    security(("bearer" = [])),
    params(
        ("tournament_id" = Uuid, Path, description = "Identifiant du tournoi"),
        Pagination,
    ),
    responses(
        (status = 200, description = "Équipes, par ordre alphabétique", body = Vec<TournamentTeam>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{tournament_id}/teams")]
async fn list_tournament_teams(
    state: web::Data<AppState>,
    tournament_id: web::Path<Uuid>,
    page: web::Query<Pagination>,
) -> Result<HttpResponse, ApiError> {
    let (limit, offset) = page.bounds();
    let tournament_id = tournament_id.into_inner();
    find_tournament(&state, tournament_id).await?;
    let teams = state
        .store
        .list_tournament_teams(tournament_id, limit, offset)
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok().json(teams))
}

/// Inscrit une équipe à un tournoi.
///
/// Avec `team_id`, copie l'équipe globale (nom, tag, photo, propriétaire, membres) : l'appelant
/// doit en être le propriétaire. Sans, crée une équipe de zéro dont l'appelant est le
/// propriétaire. Une équipe globale ne s'inscrit qu'une fois par tournoi et un joueur n'est que
/// dans une équipe par tournoi.
#[utoipa::path(
    post,
    path = "/tournaments/{tournament_id}/teams",
    tag = "tournament-teams",
    security(("bearer" = [])),
    params(("tournament_id" = Uuid, Path, description = "Identifiant du tournoi")),
    request_body = CreateTournamentTeamRequest,
    responses(
        (status = 201, description = "Équipe de tournoi créée", body = TournamentTeam),
        (status = 400, description = "Requête invalide ou équipe globale introuvable", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé au propriétaire de l'équipe globale", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
        (status = 409, description = "Équipe déjà inscrite, joueur déjà dans une équipe du tournoi, ou tournoi en cours ou terminé", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{tournament_id}/teams")]
async fn create_tournament_team(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    tournament_id: web::Path<Uuid>,
    body: web::Json<CreateTournamentTeamRequest>,
) -> Result<HttpResponse, ApiError> {
    let tournament = find_tournament(&state, tournament_id.into_inner()).await?;
    if !matches!(
        tournament.status,
        TournamentStatus::Draft | TournamentStatus::Registration
    ) {
        return Err(ApiError::TournamentLocked);
    }
    let tournament_id = tournament.id;
    let CreateTournamentTeamRequest {
        team_id,
        member_ids,
        name,
        tag,
        picture_url,
    } = body.into_inner();
    let input = match team_id {
        Some(team_id) => {
            if name.is_some() || tag.is_some() || picture_url.is_some() {
                return Err(ApiError::Validation(vec![(
                    "team_id",
                    "`name`, `tag` et `picture_url` sont copiés de l'équipe globale : ne les \
                     renseignez pas avec `team_id`."
                        .to_string(),
                )]));
            }
            copy_of_team(&state, &claims, &tournament, team_id, member_ids).await?
        }
        None => {
            if member_ids.is_some() {
                return Err(ApiError::Validation(vec![(
                    "member_ids",
                    "`member_ids` n'a de sens qu'avec `team_id`.".to_string(),
                )]));
            }
            let name = name.map(|n| n.trim().to_string()).unwrap_or_default();
            let tag = tag.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
            let picture_url = picture_url
                .map(|u| u.trim().to_string())
                .filter(|u| !u.is_empty());
            let errors = validate(Some(&name), tag.as_deref(), picture_url.as_deref());
            if !errors.is_empty() {
                return Err(ApiError::Validation(errors));
            }
            TournamentTeamInput {
                tournament_id,
                team_id: None,
                name,
                tag,
                picture_url,
                owner_id: claims.sub,
                members: vec![(claims.sub, TeamRole::Owner)],
            }
        }
    };
    let team = state
        .store
        .create_tournament_team(input)
        .await
        .map_err(store_error)?;
    Ok(HttpResponse::Created().json(team))
}

/// Détail d'une équipe de tournoi.
#[utoipa::path(
    get,
    path = "/tournament-teams/{id}",
    tag = "tournament-teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de l'équipe de tournoi")),
    responses(
        (status = 200, description = "L'équipe de tournoi", body = TournamentTeam),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Équipe introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournament-teams/{id}")]
async fn get_tournament_team(
    state: web::Data<AppState>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    Ok(HttpResponse::Ok().json(find(&state, id.into_inner()).await?))
}

/// Modifie une équipe de tournoi (propriétaire). N'a aucun effet sur l'équipe globale d'origine.
#[utoipa::path(
    patch,
    path = "/tournament-teams/{id}",
    tag = "tournament-teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de l'équipe de tournoi")),
    request_body = UpdateTournamentTeamRequest,
    responses(
        (status = 200, description = "Équipe modifiée", body = TournamentTeam),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé au propriétaire", body = ErrorResponse),
        (status = 404, description = "Équipe introuvable", body = ErrorResponse),
    ),
)]
#[patch("/tournament-teams/{id}")]
async fn update_tournament_team(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<UpdateTournamentTeamRequest>,
) -> Result<HttpResponse, ApiError> {
    let team = find(&state, id.into_inner()).await?;
    require_owner(&claims, team.owner_id)?;
    let UpdateTournamentTeamRequest {
        name,
        tag,
        picture_url,
    } = body.into_inner();
    let update: TeamUpdate = team_update_parts(name, tag, picture_url)?;
    let team = state
        .store
        .update_tournament_team(team.id, update)
        .await
        .map_err(store_error)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(team))
}

/// Supprime une équipe de tournoi et ses membres (propriétaire). N'a aucun effet sur l'équipe
/// globale d'origine.
#[utoipa::path(
    delete,
    path = "/tournament-teams/{id}",
    tag = "tournament-teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de l'équipe de tournoi")),
    responses(
        (status = 204, description = "Équipe supprimée"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé au propriétaire", body = ErrorResponse),
        (status = 404, description = "Équipe introuvable", body = ErrorResponse),
    ),
)]
#[delete("/tournament-teams/{id}")]
async fn delete_tournament_team(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let team = find(&state, id.into_inner()).await?;
    require_owner(&claims, team.owner_id)?;
    if state
        .store
        .delete_tournament_team(team.id)
        .await
        .map_err(ApiError::internal)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

/// Membres d'une équipe de tournoi.
#[utoipa::path(
    get,
    path = "/tournament-teams/{id}/members",
    tag = "tournament-teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de l'équipe de tournoi")),
    responses(
        (status = 200, description = "Membres", body = Vec<TournamentTeamMember>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Équipe introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournament-teams/{id}/members")]
async fn list_members(
    state: web::Data<AppState>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let members = state
        .store
        .list_tournament_team_members(id.into_inner())
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(members))
}

/// Ajoute un compte à l'équipe de tournoi (propriétaire). Le rôle `owner` n'est pas attribuable.
#[utoipa::path(
    post,
    path = "/tournament-teams/{id}/members",
    tag = "tournament-teams",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant de l'équipe de tournoi")),
    request_body = AddMemberRequest,
    responses(
        (status = 201, description = "Membre ajouté", body = TournamentTeamMember),
        (status = 400, description = "Requête invalide ou compte introuvable", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé au propriétaire", body = ErrorResponse),
        (status = 404, description = "Équipe introuvable", body = ErrorResponse),
        (status = 409, description = "Joueur déjà dans une équipe de ce tournoi", body = ErrorResponse),
    ),
)]
#[post("/tournament-teams/{id}/members")]
async fn add_member(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    id: web::Path<Uuid>,
    body: web::Json<AddMemberRequest>,
) -> Result<HttpResponse, ApiError> {
    let team = find(&state, id.into_inner()).await?;
    require_owner(&claims, team.owner_id)?;
    let AddMemberRequest { user_id, role } = body.into_inner();
    require_assignable(role)?;
    let member = state
        .store
        .add_tournament_team_member(team.id, user_id, role)
        .await
        .map_err(store_error)?
        .ok_or_else(|| ApiError::Validation(vec![("user_id", "Compte introuvable.".into())]))?;
    Ok(HttpResponse::Created().json(member))
}

/// Change le rôle d'un membre (propriétaire). Le rôle du propriétaire est fixe.
#[utoipa::path(
    patch,
    path = "/tournament-teams/{id}/members/{user_id}",
    tag = "tournament-teams",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant de l'équipe de tournoi"),
        ("user_id" = Uuid, Path, description = "Identifiant du compte"),
    ),
    request_body = UpdateMemberRequest,
    responses(
        (status = 200, description = "Rôle modifié", body = TournamentTeamMember),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé au propriétaire", body = ErrorResponse),
        (status = 404, description = "Équipe ou membre introuvable", body = ErrorResponse),
    ),
)]
#[patch("/tournament-teams/{id}/members/{user_id}")]
async fn update_member(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
    body: web::Json<UpdateMemberRequest>,
) -> Result<HttpResponse, ApiError> {
    let (id, user_id) = path.into_inner();
    let team = find(&state, id).await?;
    require_owner(&claims, team.owner_id)?;
    require_assignable(body.role)?;
    if user_id == team.owner_id {
        return Err(owner_is_fixed());
    }
    let member = state
        .store
        .set_tournament_team_member_role(team.id, user_id, body.role)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(member))
}

/// Retire un membre de l'équipe de tournoi (propriétaire). Le propriétaire ne peut pas être
/// retiré.
#[utoipa::path(
    delete,
    path = "/tournament-teams/{id}/members/{user_id}",
    tag = "tournament-teams",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant de l'équipe de tournoi"),
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
#[delete("/tournament-teams/{id}/members/{user_id}")]
async fn remove_member(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (id, user_id) = path.into_inner();
    let team = find(&state, id).await?;
    require_owner(&claims, team.owner_id)?;
    if user_id == team.owner_id {
        return Err(owner_is_fixed());
    }
    if state
        .store
        .remove_tournament_team_member(team.id, user_id)
        .await
        .map_err(ApiError::internal)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

async fn find(state: &AppState, id: Uuid) -> Result<TournamentTeam, ApiError> {
    state
        .store
        .find_tournament_team(id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)
}

/// Copie d'une équipe globale : tout est recopié, rien ne reste lié à l'original.
async fn copy_of_team(
    state: &AppState,
    claims: &Claims,
    tournament: &Tournament,
    team_id: Uuid,
    member_ids: Option<Vec<Uuid>>,
) -> Result<TournamentTeamInput, ApiError> {
    let team = state
        .store
        .find_team(team_id)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::Validation(vec![("team_id", "Équipe introuvable.".into())]))?;
    require_owner(claims, team.owner_id)?;
    if team.game_id != tournament.game_id {
        return Err(ApiError::Validation(vec![(
            "team_id",
            "Cette équipe n'est pas du jeu du tournoi.".to_string(),
        )]));
    }
    let active: Vec<(Uuid, TeamRole)> = state
        .store
        .list_team_members(team_id)
        .await
        .map_err(ApiError::internal)?
        .unwrap_or_default()
        .into_iter()
        .filter(|member| member.left_at.is_none())
        .map(|member| (member.user_id, member.role))
        .collect();
    let members = match member_ids {
        None => active,
        Some(ids) => {
            let wanted: HashSet<Uuid> = ids.into_iter().collect();
            if let Some(stranger) = wanted
                .iter()
                .find(|id| !active.iter().any(|(user_id, _)| user_id == *id))
            {
                return Err(ApiError::Validation(vec![(
                    "member_ids",
                    format!("Le compte {stranger} n'est pas membre actif de l'équipe."),
                )]));
            }
            active
                .into_iter()
                .filter(|(user_id, role)| *role == TeamRole::Owner || wanted.contains(user_id))
                .collect()
        }
    };
    Ok(TournamentTeamInput {
        tournament_id: tournament.id,
        team_id: Some(team.id),
        name: team.name,
        tag: team.tag,
        picture_url: team.picture_url,
        owner_id: team.owner_id,
        members,
    })
}

fn store_error(err: StoreError) -> ApiError {
    match err {
        StoreError::TeamAlreadyRegistered => ApiError::TeamAlreadyRegistered,
        StoreError::PlayerAlreadyRegistered => ApiError::PlayerAlreadyRegistered,
        other => ApiError::internal(other),
    }
}

async fn find_tournament(state: &AppState, id: Uuid) -> Result<Tournament, ApiError> {
    state
        .store
        .find_tournament(id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)
}
