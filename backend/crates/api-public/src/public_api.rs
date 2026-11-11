//! Consultation publique des tournois, sans jeton : détails, participants, classements,
//! calendrier des étapes et des matchs (tableaux compris).
//!
//! Lecture seule. Seuls les tournois `public` et lancés (ni brouillon, ni modèle) sont
//! exposés ; un tournoi `invitation_only` est introuvable (404), de même que toutes ses
//! ressources enfants. Les données privées (propriétaire, identifiants de comptes, réponses
//! d'inscription, détail des joueurs d'une équipe) ne sortent jamais d'ici : les joueurs
//! apparaissent par leur nom d'utilisateur. Toute modification passe par les routes
//! authentifiées de `/tournaments`.

use crate::auth::AppState;
use crate::error::{ApiError, ErrorResponse};
use crate::matches::{MatchDetail, load_details};
use crate::steps::{GroupRanking, find_step, group_rankings, steps_of};
use crate::store::{
    MatchStatus, ParticipantStatus, ParticipantType, Step, Tournament, TournamentSettings,
    TournamentStatus, Visibility,
};
use crate::teams::Pagination;
use crate::tournaments::{TeamRank, find_tournament, player_ranks, settle_if_due, team_ranks};
use actix_web::{HttpResponse, get, web};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use utoipa::{IntoParams, ToSchema};
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(list_public_tournaments)
        .service(get_public_tournament)
        .service(public_participants)
        .service(public_ranking)
        .service(public_team_ranking)
        .service(public_steps)
        .service(public_step_ranking)
        .service(public_matches);
}

/// Un tournoi tel que le voit un visiteur.
#[derive(Serialize, ToSchema)]
struct PublicTournament {
    id: Uuid,
    game_id: Uuid,
    name: String,
    description: Option<String>,
    start_date: String,
    end_date: String,
    registration_open_at: Option<String>,
    registration_close_at: Option<String>,
    participant_type: ParticipantType,
    max_participants: i32,
    #[serde(flatten)]
    settings: TournamentSettings,
    status: TournamentStatus,
}

impl From<Tournament> for PublicTournament {
    fn from(t: Tournament) -> Self {
        PublicTournament {
            id: t.id,
            game_id: t.game_id,
            name: t.name,
            description: t.description,
            start_date: t.start_date,
            end_date: t.end_date,
            registration_open_at: t.registration_open_at,
            registration_close_at: t.registration_close_at,
            participant_type: t.participant_type,
            max_participants: t.max_participants,
            settings: t.settings,
            status: t.status,
        }
    }
}

/// Un inscrit : un joueur (nom d'utilisateur) ou une équipe (nom d'équipe).
#[derive(Serialize, ToSchema)]
struct PublicParticipant {
    /// Inscription ; relie les classements et les matchs.
    id: Uuid,
    /// `player` ou `team`.
    kind: &'static str,
    name: String,
    /// Nom de l'équipe pour laquelle un joueur marque, le cas échéant.
    team: Option<String>,
    status: ParticipantStatus,
}

#[derive(Serialize, ToSchema)]
struct PublicPlayerRank {
    rank: u32,
    participant_id: Uuid,
    username: String,
    points: f64,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct PublicQuery {
    game_id: Option<Uuid>,
    status: Option<TournamentStatus>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct PublicMatchesQuery {
    /// Ne renvoie que les matchs de ce groupe.
    group_id: Option<Uuid>,
    status: Option<MatchStatus>,
}

/// Un tournoi n'est public que s'il est ouvert à tous, lancé et pas un modèle.
fn is_public(tournament: &Tournament) -> bool {
    tournament.settings.visibility == Visibility::Public
        && !tournament.is_template
        && tournament.status != TournamentStatus::Draft
}

async fn public_tournament(state: &AppState, id: Uuid) -> Result<Tournament, ApiError> {
    let tournament = find_tournament(state, id).await?;
    if !is_public(&tournament) {
        return Err(ApiError::NotFound);
    }
    settle_if_due(state, tournament).await
}

/// Tournois publics (inscriptions ouvertes, en cours ou terminés), par date de début.
#[utoipa::path(
    get,
    path = "/public/tournaments",
    tag = "public",
    params(PublicQuery),
    responses((status = 200, description = "Tournois publics", body = Vec<PublicTournament>)),
)]
#[get("/public/tournaments")]
async fn list_public_tournaments(
    state: web::Data<AppState>,
    query: web::Query<PublicQuery>,
) -> Result<HttpResponse, ApiError> {
    let (limit, offset) = Pagination::new(query.limit, query.offset).bounds();
    let tournaments: Vec<PublicTournament> = state
        .store
        .list_tournaments(query.game_id, query.status, false, i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        .filter(is_public)
        .skip(usize::try_from(offset).unwrap_or(0))
        .take(usize::try_from(limit).unwrap_or(0))
        .map(PublicTournament::from)
        .collect();
    Ok(HttpResponse::Ok().json(tournaments))
}

/// Détail d'un tournoi public.
#[utoipa::path(
    get,
    path = "/public/tournaments/{id}",
    tag = "public",
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 200, description = "Le tournoi", body = PublicTournament),
        (status = 404, description = "Tournoi introuvable ou privé", body = ErrorResponse),
    ),
)]
#[get("/public/tournaments/{id}")]
async fn get_public_tournament(
    state: web::Data<AppState>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament = public_tournament(&state, id.into_inner()).await?;
    Ok(HttpResponse::Ok().json(PublicTournament::from(tournament)))
}

/// Inscrits en lice d'un tournoi public (`registered` et `checked_in`), par date d'inscription.
#[utoipa::path(
    get,
    path = "/public/tournaments/{id}/participants",
    tag = "public",
    params(("id" = Uuid, Path, description = "Identifiant du tournoi"), Pagination),
    responses(
        (status = 200, description = "Inscrits", body = Vec<PublicParticipant>),
        (status = 404, description = "Tournoi introuvable ou privé", body = ErrorResponse),
    ),
)]
#[get("/public/tournaments/{id}/participants")]
async fn public_participants(
    state: web::Data<AppState>,
    id: web::Path<Uuid>,
    page: web::Query<Pagination>,
) -> Result<HttpResponse, ApiError> {
    let tournament = public_tournament(&state, id.into_inner()).await?;
    let (limit, offset) = page.bounds();
    let teams: HashMap<Uuid, String> = state
        .store
        .list_tournament_teams(tournament.id, i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        .map(|team| (team.id, team.name))
        .collect();
    let all = state
        .store
        .list_participants(tournament.id, i64::MAX, 0)
        .await
        .map_err(ApiError::internal)?;
    let mut out = Vec::new();
    for participant in all.into_iter().filter(|p| {
        matches!(
            p.status,
            ParticipantStatus::Registered | ParticipantStatus::CheckedIn
        )
    }) {
        let team = participant
            .tournament_team_id
            .and_then(|id| teams.get(&id).cloned());
        let (kind, name) = match participant.user_id {
            Some(user_id) => ("player", username(&state, user_id).await?),
            None => ("team", team.clone().unwrap_or_default()),
        };
        out.push(PublicParticipant {
            id: participant.id,
            kind,
            name,
            team: if kind == "player" { team } else { None },
            status: participant.status,
        });
    }
    let out: Vec<PublicParticipant> = out
        .into_iter()
        .skip(usize::try_from(offset).unwrap_or(0))
        .take(usize::try_from(limit).unwrap_or(0))
        .collect();
    Ok(HttpResponse::Ok().json(out))
}

async fn username(state: &AppState, user_id: Uuid) -> Result<String, ApiError> {
    Ok(state
        .store
        .find_profile(user_id)
        .await
        .map_err(ApiError::internal)?
        .map(|profile| profile.username)
        .unwrap_or_default())
}

/// Classement des joueurs d'un tournoi solo public.
#[utoipa::path(
    get,
    path = "/public/tournaments/{id}/ranking",
    tag = "public",
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 200, description = "Classement des joueurs", body = Vec<PublicPlayerRank>),
        (status = 404, description = "Tournoi introuvable ou privé", body = ErrorResponse),
    ),
)]
#[get("/public/tournaments/{id}/ranking")]
async fn public_ranking(
    state: web::Data<AppState>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament = public_tournament(&state, id.into_inner()).await?;
    let mut ranking = Vec::new();
    for entry in player_ranks(&state, &tournament).await? {
        ranking.push(PublicPlayerRank {
            rank: entry.rank,
            participant_id: entry.participant_id,
            username: username(&state, entry.user_id).await?,
            points: entry.points,
        });
    }
    Ok(HttpResponse::Ok().json(ranking))
}

/// Classement des équipes d'un tournoi public.
#[utoipa::path(
    get,
    path = "/public/tournaments/{id}/team-ranking",
    tag = "public",
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 200, description = "Classement des équipes", body = Vec<TeamRank>),
        (status = 404, description = "Tournoi introuvable ou privé", body = ErrorResponse),
    ),
)]
#[get("/public/tournaments/{id}/team-ranking")]
async fn public_team_ranking(
    state: web::Data<AppState>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament = public_tournament(&state, id.into_inner()).await?;
    Ok(HttpResponse::Ok().json(team_ranks(&state, &tournament).await?))
}

/// Étapes d'un tournoi public (déroulé du tournoi).
#[utoipa::path(
    get,
    path = "/public/tournaments/{id}/steps",
    tag = "public",
    params(("id" = Uuid, Path, description = "Identifiant du tournoi")),
    responses(
        (status = 200, description = "Étapes, par position", body = Vec<Step>),
        (status = 404, description = "Tournoi introuvable ou privé", body = ErrorResponse),
    ),
)]
#[get("/public/tournaments/{id}/steps")]
async fn public_steps(
    state: web::Data<AppState>,
    id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    let tournament = public_tournament(&state, id.into_inner()).await?;
    Ok(HttpResponse::Ok().json(steps_of(&state, tournament.id).await?))
}

/// Classement de chaque groupe d'une étape d'un tournoi public.
#[utoipa::path(
    get,
    path = "/public/tournaments/{id}/steps/{step_id}/ranking",
    tag = "public",
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
    ),
    responses(
        (status = 200, description = "Classement par groupe", body = Vec<GroupRanking>),
        (status = 404, description = "Tournoi ou étape introuvable, ou tournoi privé", body = ErrorResponse),
    ),
)]
#[get("/public/tournaments/{id}/steps/{step_id}/ranking")]
async fn public_step_ranking(
    state: web::Data<AppState>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, step_id) = path.into_inner();
    let tournament = public_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament.id, step_id).await?;
    Ok(HttpResponse::Ok().json(group_rankings(&state, &step).await?))
}

/// Matchs d'une étape d'un tournoi public : calendrier, résultats et chaînage du tableau
/// (`next_match_id`, `bracket`). Le détail par joueur des statistiques d'équipe n'est pas
/// exposé.
#[utoipa::path(
    get,
    path = "/public/tournaments/{id}/steps/{step_id}/matches",
    tag = "public",
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
        PublicMatchesQuery,
    ),
    responses(
        (status = 200, description = "Matchs avec leurs participants", body = Vec<MatchDetail>),
        (status = 404, description = "Tournoi ou étape introuvable, ou tournoi privé", body = ErrorResponse),
    ),
)]
#[get("/public/tournaments/{id}/steps/{step_id}/matches")]
async fn public_matches(
    state: web::Data<AppState>,
    path: web::Path<(Uuid, Uuid)>,
    query: web::Query<PublicMatchesQuery>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, step_id) = path.into_inner();
    let tournament = public_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament.id, step_id).await?;
    let mut details = load_details(&state, &step, query.group_id, query.status).await?;
    for detail in &mut details {
        for participant in &mut detail.participants {
            if let Some(stats) = participant.stats.as_object_mut() {
                stats.remove("players");
            }
        }
    }
    Ok(HttpResponse::Ok().json(details))
}
