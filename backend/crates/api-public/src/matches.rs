//! Matchs d'une étape : création, planification, saisie des résultats, clôture d'un match avec
//! calcul des points, propagation du vainqueur en élimination et clôture automatique de l'étape.
//!
//! Toutes ces routes exigent un jeton d'accès. La consultation est ouverte à tout compte ; la
//! création, la modification, la suppression, la saisie des résultats et les changements de
//! statut sont réservés aux administrateurs, et seulement tant que l'étape est `ongoing` (ses
//! groupes n'existent qu'à son lancement).
//!
//! Les statistiques d'un participant (`stats`) sont un objet JSON dont les clés sont les
//! statistiques liées au jeu du tournoi (`stat.key`). Pour une équipe, elles peuvent détailler
//! chaque joueur : `{"total": {...}, "players": {"<user_id>": {...}}}`, les points étant alors
//! calculés sur `total`. Les points viennent du barème du tournoi (`scoring_rule`) ; une
//! statistique sans règle ne rapporte rien.
//!
//! Les matchs d'une étape se génèrent automatiquement (module `generation`) ou se créent à la
//! main avec `POST .../matches`. Un match généré porte sa série (`best_of` : 1, 3 ou 5) : en duel
//! au meilleur de 3 ou 5, chaque participant déclare ses manches gagnées (`games_won`) et le
//! vainqueur de la série est celui qui atteint la majorité. `round` reste la ronde de
//! compétition, distincte des manches d'une série. Le barème de l'étape (`rules.scoring`),
//! s'il existe, remplace les points issus des statistiques pour cette étape.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::generation::generate_next_round;
use crate::steps::{CloseResponse, close_step_of, find_step};
use crate::store::{
    Bracket, Match, MatchFinish, MatchInput, MatchParticipant, MatchResult, MatchScore,
    MatchStatus, MatchType, MatchUpdate, Placement, ScoringRule, Stat, StatType, Step, StepFormat,
    StepStatus, StoreError, Tournament,
};
use crate::team_io::normalize_timestamp;
use crate::tournaments::{find_tournament, nullable};
use crate::users::require_admin;
use actix_web::{HttpResponse, delete, get, patch, post, put, web};
use domain::bracket::grand_final_ends_tournament;
use domain::seeding::{games_to_win, series_is_decided};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use utoipa::{IntoParams, ToSchema};
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

pub(crate) const ROUND_MAX: i32 = 1_000;
const STAT_VALUE_MAX: f64 = 1_000_000_000.0;

/// Routes des matchs, avec leur documentation OpenAPI.
pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(list_matches)
        .service(get_match)
        .service(create_match)
        .service(update_match)
        .service(delete_match)
        .service(save_results)
        .service(set_status);
}

#[derive(Deserialize, ToSchema)]
struct CreateMatchRequest {
    /// Groupe de l'étape où se joue le match.
    group_id: Uuid,
    /// N° de manche (`pool`), de ronde (`swiss`) ou de tour (élimination), à partir de 1.
    #[schema(minimum = 1, maximum = 1000, example = 1)]
    round: Option<i32>,
    /// Tableau du match, en double élimination seulement.
    bracket: Option<Bracket>,
    /// Match de la même étape où va le vainqueur, en élimination seulement.
    next_match_id: Option<Uuid>,
    /// Horodatage RFC 3339 en UTC (suffixe `Z`).
    #[schema(example = "2026-11-14T18:00:00Z")]
    scheduled_at: Option<String>,
    /// Inscrits du groupe qui jouent le match : exactement 2 en `duel`, de 2 à `group_size` en
    /// `ffa` au moment de le lancer. Vide pour un match d'élimination qui attend son vainqueur.
    participant_ids: Option<Vec<Uuid>>,
}

/// Champs modifiables, tous facultatifs ; `null` efface une valeur facultative.
#[derive(Deserialize, ToSchema)]
struct UpdateMatchRequest {
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<i32>, minimum = 1, maximum = 1000)]
    round: Option<Option<i32>>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<Bracket>)]
    bracket: Option<Option<Bracket>>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<Uuid>)]
    next_match_id: Option<Option<Uuid>>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<String>)]
    scheduled_at: Option<Option<String>>,
    /// Remplace les participants ; seulement tant que le match est `scheduled`.
    participant_ids: Option<Vec<Uuid>>,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct MatchesQuery {
    /// Ne renvoie que les matchs de ce groupe.
    group_id: Option<Uuid>,
    status: Option<MatchStatus>,
}

/// Résultats à enregistrer ; ceux des participants non listés ne changent pas.
#[derive(Deserialize, ToSchema)]
struct ResultsRequest {
    results: Vec<ResultEntry>,
}

/// Résultat d'un participant. Il remplace le précédent : `rank` et `result` absents sont effacés.
#[derive(Deserialize, ToSchema)]
struct ResultEntry {
    /// Inscrit au tournoi (`tournament_participant.id`), participant du match.
    participant_id: Uuid,
    /// Valeur de chaque statistique du jeu, par clé (`stat.key`).
    #[schema(value_type = Object, example = json!({"placement": 2, "kills": 7}))]
    stats: Value,
    /// Place dans le match, de 1 au nombre de participants. Calculée d'après les points à la
    /// fin du match si aucun participant n'en a.
    #[schema(minimum = 1)]
    rank: Option<i32>,
    /// Manches gagnées dans une série (BO3, BO5), de 0 au nombre à gagner ; exigé pour terminer
    /// un duel au meilleur de 3 ou 5.
    #[schema(minimum = 0)]
    games_won: Option<i32>,
    /// `win` pour la première place, `loss` sinon, `draw` en cas d'égalité en tête, si absent à
    /// la fin du match.
    result: Option<MatchResult>,
}

#[derive(Deserialize, ToSchema)]
struct StatusRequest {
    /// `ongoing`, `finished` ou `cancelled`.
    status: MatchStatus,
}

/// Un match avec ses participants.
#[derive(Serialize, ToSchema)]
pub(crate) struct MatchDetail {
    #[serde(flatten)]
    #[schema(inline)]
    pub(crate) r#match: Match,
    pub(crate) participants: Vec<MatchParticipant>,
}

/// Résultat d'un changement de statut.
#[derive(Serialize, ToSchema)]
struct MatchOutcome {
    #[serde(flatten)]
    #[schema(inline)]
    detail: MatchDetail,
    /// Renseigné quand ce match était le dernier de l'étape, qui s'est alors clôturée.
    step_closed: Option<CloseResponse>,
}

/// Matchs de l'étape, par groupe puis par manche, avec leurs participants.
#[utoipa::path(
    get,
    path = "/tournaments/{id}/steps/{step_id}/matches",
    tag = "matches",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
        MatchesQuery,
    ),
    responses(
        (status = 200, description = "Les matchs de l'étape", body = Vec<MatchDetail>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi ou étape introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/steps/{step_id}/matches")]
async fn list_matches(
    state: web::Data<AppState>,
    path: web::Path<(Uuid, Uuid)>,
    query: web::Query<MatchesQuery>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, step_id) = path.into_inner();
    find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    let matches = state
        .store
        .list_matches(step.id, query.group_id, query.status)
        .await
        .map_err(ApiError::internal)?;
    let mut participants = participants_by_match(&state, &step).await?;
    let details: Vec<MatchDetail> = matches
        .into_iter()
        .map(|m| MatchDetail {
            participants: participants.remove(&m.id).unwrap_or_default(),
            r#match: m,
        })
        .collect();
    Ok(HttpResponse::Ok().json(details))
}

/// Détail d'un match avec ses participants.
#[utoipa::path(
    get,
    path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}",
    tag = "matches",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
        ("match_id" = Uuid, Path, description = "Identifiant du match"),
    ),
    responses(
        (status = 200, description = "Le match", body = MatchDetail),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi, étape ou match introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/steps/{step_id}/matches/{match_id}")]
async fn get_match(
    state: web::Data<AppState>,
    path: web::Path<(Uuid, Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, step_id, match_id) = path.into_inner();
    find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    let found = find_match(&state, &step, match_id).await?;
    Ok(HttpResponse::Ok().json(detail_of(&state, &step, found).await?))
}

/// Crée un match `scheduled` dans un groupe de l'étape (administrateur).
#[utoipa::path(
    post,
    path = "/tournaments/{id}/steps/{step_id}/matches",
    tag = "matches",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
    ),
    request_body = CreateMatchRequest,
    responses(
        (status = 201, description = "Match créé", body = MatchDetail),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi ou étape introuvable", body = ErrorResponse),
        (status = 409, description = "L'étape n'est pas en cours", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/steps/{step_id}/matches")]
async fn create_match(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
    body: web::Json<CreateMatchRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, step_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    let request = body.into_inner();
    let mut errors = Vec::new();
    let round = check_round(request.round, &mut errors);
    let scheduled_at = check_scheduled_at(request.scheduled_at, &mut errors);
    check_bracket(&step, request.bracket, &mut errors);
    let participants = request.participant_ids.unwrap_or_default();
    if let Some(next) = request.next_match_id {
        check_next(&state, &step, None, next, &mut errors).await?;
    }
    let groups = state
        .store
        .list_step_groups(step.id)
        .await
        .map_err(ApiError::internal)?;
    if !groups.iter().any(|g| g.id == request.group_id) {
        errors.push(("group_id", "Ce groupe n'appartient pas à l'étape.".into()));
    } else {
        check_participants(&state, &step, request.group_id, &participants, &mut errors).await?;
    }
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    require_ongoing(&step)?;
    let created = state
        .store
        .create_match(MatchInput {
            game_id: tournament.game_id,
            step_id: step.id,
            group_id: request.group_id,
            round,
            bracket: request.bracket,
            next_match_id: request.next_match_id,
            scheduled_at,
            participants,
        })
        .await
        .map_err(match_error)?;
    Ok(HttpResponse::Created().json(detail_of(&state, &step, created).await?))
}

/// Modifie un match `scheduled` ou `ongoing` (administrateur).
#[utoipa::path(
    patch,
    path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}",
    tag = "matches",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
        ("match_id" = Uuid, Path, description = "Identifiant du match"),
    ),
    request_body = UpdateMatchRequest,
    responses(
        (status = 200, description = "Match modifié", body = MatchDetail),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi, étape ou match introuvable", body = ErrorResponse),
        (status = 409, description = "Étape non en cours, match terminé ou annulé, ou participants d'un match déjà lancé", body = ErrorResponse),
    ),
)]
#[patch("/tournaments/{id}/steps/{step_id}/matches/{match_id}")]
async fn update_match(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid, Uuid)>,
    body: web::Json<UpdateMatchRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, step_id, match_id) = path.into_inner();
    find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    let current = find_match(&state, &step, match_id).await?;
    let request = body.into_inner();
    let mut errors = Vec::new();
    let mut update = MatchUpdate::default();
    if let Some(round) = request.round {
        update.round = Some(check_round(round, &mut errors));
    }
    if let Some(bracket) = request.bracket {
        check_bracket(&step, bracket, &mut errors);
        update.bracket = Some(bracket);
    }
    if let Some(scheduled_at) = request.scheduled_at {
        update.scheduled_at = Some(check_scheduled_at(scheduled_at, &mut errors));
    }
    if let Some(next) = request.next_match_id {
        if let Some(next) = next {
            check_next(&state, &step, Some(current.id), next, &mut errors).await?;
        }
        update.next_match_id = Some(next);
    }
    if let Some(group_id) = current.group_id
        && let Some(participants) = &request.participant_ids
    {
        check_participants(&state, &step, group_id, participants, &mut errors).await?;
        update.participants = Some(participants.clone());
    }
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    require_ongoing(&step)?;
    if !matches!(
        current.status,
        MatchStatus::Scheduled | MatchStatus::Ongoing
    ) || (update.participants.is_some() && current.status != MatchStatus::Scheduled)
    {
        return Err(ApiError::InvalidTransition);
    }
    let updated = state
        .store
        .update_match(current.id, update)
        .await
        .map_err(match_error)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(detail_of(&state, &step, updated).await?))
}

/// Supprime un match `scheduled`, `ongoing` ou `cancelled` et ses participants (administrateur).
/// Un match `finished` compte dans les points de l'étape : il ne se supprime pas.
#[utoipa::path(
    delete,
    path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}",
    tag = "matches",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
        ("match_id" = Uuid, Path, description = "Identifiant du match"),
    ),
    responses(
        (status = 204, description = "Match supprimé"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi, étape ou match introuvable", body = ErrorResponse),
        (status = 409, description = "Étape non en cours, ou match terminé", body = ErrorResponse),
    ),
)]
#[delete("/tournaments/{id}/steps/{step_id}/matches/{match_id}")]
async fn delete_match(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, step_id, match_id) = path.into_inner();
    find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    let current = find_match(&state, &step, match_id).await?;
    require_ongoing(&step)?;
    if current.status == MatchStatus::Finished {
        return Err(ApiError::InvalidTransition);
    }
    if state
        .store
        .delete_match(current.id)
        .await
        .map_err(ApiError::internal)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

/// Enregistre les statistiques des participants d'un match `scheduled` ou `ongoing`
/// (administrateur) et calcule leurs points d'après le barème du tournoi.
///
/// Les clés de `stats` sont les statistiques liées au jeu, avec une valeur numérique (0 à 100
/// pour un pourcentage). Le match se termine par `POST .../status`.
#[utoipa::path(
    put,
    path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}/results",
    tag = "matches",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
        ("match_id" = Uuid, Path, description = "Identifiant du match"),
    ),
    request_body = ResultsRequest,
    responses(
        (status = 200, description = "Résultats enregistrés", body = MatchDetail),
        (status = 400, description = "Statistiques invalides ou participant étranger au match", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi, étape ou match introuvable", body = ErrorResponse),
        (status = 409, description = "Étape non en cours, ou match terminé ou annulé", body = ErrorResponse),
    ),
)]
#[put("/tournaments/{id}/steps/{step_id}/matches/{match_id}/results")]
async fn save_results(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid, Uuid)>,
    body: web::Json<ResultsRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, step_id, match_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    let current = find_match(&state, &step, match_id).await?;
    require_ongoing(&step)?;
    if !matches!(
        current.status,
        MatchStatus::Scheduled | MatchStatus::Ongoing
    ) {
        return Err(ApiError::InvalidTransition);
    }
    let request = body.into_inner();
    let members = match_participants(&state, &step, current.id).await?;
    let (stats, rules) = scoring_of(&state, &tournament).await?;
    let known: HashMap<String, StatType> = stats.iter().map(|s| (s.key.clone(), s.kind)).collect();

    let mut errors = Vec::new();
    let mut seen = HashSet::new();
    let mut scores = Vec::with_capacity(request.results.len());
    if request.results.is_empty() {
        errors.push(("results", "Au moins un résultat est attendu.".to_string()));
    }
    for entry in request.results {
        let id = entry.participant_id;
        if !members.iter().any(|m| m.participant_id == id) {
            errors.push(("results", format!("{id} ne participe pas à ce match.")));
            continue;
        }
        if !seen.insert(id) {
            errors.push(("results", format!("{id} apparaît plusieurs fois.")));
            continue;
        }
        if let Some(rank) = entry.rank
            && !(1..=i32::try_from(members.len()).unwrap_or(i32::MAX)).contains(&rank)
        {
            errors.push((
                "results",
                format!(
                    "Le rang de {id} doit aller de 1 à {} (nombre de participants).",
                    members.len()
                ),
            ));
            continue;
        }
        if let Some(games) = entry.games_won
            && !(0..=games_to_win(current.best_of)).contains(&games)
        {
            errors.push((
                "results",
                format!(
                    "Les manches gagnées de {id} vont de 0 à {} (série au meilleur de {}).",
                    games_to_win(current.best_of),
                    current.best_of
                ),
            ));
            continue;
        }
        match parse_stats(&entry.stats, &known) {
            Ok(totals) => scores.push(MatchScore {
                participant_id: id,
                points: points_of(&totals, &rules, &stats),
                stats: entry.stats,
                rank: entry.rank,
                result: entry.result,
                games_won: entry.games_won,
                slot: None,
            }),
            Err(problem) => errors.push(("results", format!("{id} : {problem}"))),
        }
    }
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    if !state
        .store
        .save_match_scores(current.id, scores)
        .await
        .map_err(match_error)?
    {
        return Err(ApiError::NotFound);
    }
    let saved = find_match(&state, &step, current.id).await?;
    Ok(HttpResponse::Ok().json(detail_of(&state, &step, saved).await?))
}

/// Change le statut d'un match (administrateur) : `scheduled` → `ongoing` → `finished`, ou
/// `cancelled` tant qu'il n'est pas terminé. Un match peut aussi passer directement de
/// `scheduled` à `finished`.
///
/// Lancer ou terminer un match exige le bon nombre de participants : exactement 2 en `duel`, de
/// 2 à `group_size` en `ffa`. Pour le terminer, chaque participant doit avoir des statistiques
/// ou un rang ; les rangs et résultats absents sont déduits des points. En élimination, le
/// vainqueur (`win`) est placé dans le match suivant (`next_match_id`). Quand tous les matchs de
/// tous les groupes de l'étape sont terminés ou annulés, l'étape est clôturée (`step_closed`).
#[utoipa::path(
    post,
    path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}/status",
    tag = "matches",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
        ("match_id" = Uuid, Path, description = "Identifiant du match"),
    ),
    request_body = StatusRequest,
    responses(
        (status = 200, description = "Match mis à jour, avec l'étape clôturée s'il y a lieu", body = MatchOutcome),
        (status = 400, description = "Participants ou résultats incompatibles avec ce statut", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi, étape ou match introuvable", body = ErrorResponse),
        (status = 409, description = "Transition impossible depuis le statut actuel, étape non en cours ou match suivant indisponible", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/steps/{step_id}/matches/{match_id}/status")]
async fn set_status(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid, Uuid)>,
    body: web::Json<StatusRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, step_id, match_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    let current = find_match(&state, &step, match_id).await?;
    require_ongoing(&step)?;
    let target = body.into_inner().status;
    let open = matches!(
        current.status,
        MatchStatus::Scheduled | MatchStatus::Ongoing
    );
    let allowed = match target {
        MatchStatus::Ongoing => current.status == MatchStatus::Scheduled,
        MatchStatus::Finished | MatchStatus::Cancelled => open,
        MatchStatus::Scheduled => false,
    };
    if !allowed {
        return Err(ApiError::InvalidTransition);
    }

    let mut step_closed = None;
    let updated = match target {
        MatchStatus::Cancelled => state
            .store
            .set_match_status(current.id, target)
            .await
            .map_err(match_error)?
            .ok_or(ApiError::NotFound)?,
        _ => {
            let members = match_participants(&state, &step, current.id).await?;
            if let Some(problem) = participants_problem(&step, members.len()) {
                return Err(ApiError::Validation(vec![("participants", problem)]));
            }
            if target == MatchStatus::Ongoing {
                state
                    .store
                    .set_match_status(current.id, target)
                    .await
                    .map_err(match_error)?
                    .ok_or(ApiError::NotFound)?
            } else {
                let finished = finish(&state, &step, &current, &members).await?;
                // Ronde suisse terminée : la suivante se génère seule (sans revanche). Si elle
                // est impossible, l'étape attend `POST .../rounds`.
                if step.format == StepFormat::Swiss
                    && current.number.is_some()
                    && let Err(err) = generate_next_round(&state, &tournament, &step, false).await
                    && !matches!(err, ApiError::InvalidTransition)
                {
                    eprintln!("api-public : ronde suivante de l'étape {} : {err}", step.id);
                }
                step_closed = close_if_complete(&state, &tournament, &step).await;
                finished
            }
        }
    };
    let step = match &step_closed {
        Some(closed) => closed.step.clone(),
        None => step,
    };
    Ok(HttpResponse::Ok().json(MatchOutcome {
        detail: detail_of(&state, &step, updated).await?,
        step_closed,
    }))
}

/// Termine le match : rangs et résultats déduits, points de l'étape recalculés, vainqueur placé
/// dans le match suivant.
async fn finish(
    state: &AppState,
    step: &Step,
    current: &Match,
    members: &[MatchParticipant],
) -> Result<Match, ApiError> {
    let mut scores =
        settle(members).map_err(|problem| ApiError::Validation(vec![("results", problem)]))?;
    apply_series(step, current, &mut scores)?;
    apply_step_scoring(step, &mut scores);
    let (placements, cancel) = progression(state, step, current, members, &scores).await?;

    // Total de l'étape : les matchs déjà terminés plus celui-ci.
    let finished_ids: HashSet<Uuid> = state
        .store
        .list_matches(step.id, None, Some(MatchStatus::Finished))
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        .map(|m| m.id)
        .collect();
    let earlier = participants_in(state, step)
        .await?
        .into_iter()
        .filter(|p| finished_ids.contains(&p.match_id));
    let mut totals: HashMap<Uuid, f64> = HashMap::new();
    for p in earlier {
        *totals.entry(p.participant_id).or_default() += p.points;
    }
    let step_points = scores
        .iter()
        .map(|s| {
            (
                s.participant_id,
                totals.get(&s.participant_id).copied().unwrap_or(0.0) + s.points,
            )
        })
        .collect();

    state
        .store
        .finish_match(MatchFinish {
            match_id: current.id,
            scores,
            placements,
            cancel,
            step_points,
        })
        .await
        .map_err(match_error)?
        .ok_or(ApiError::NotFound)
}

/// Série au meilleur de 3 ou 5 : le vainqueur est celui qui atteint la majorité des manches, qui
/// remplace le classement déduit des points.
fn apply_series(step: &Step, current: &Match, scores: &mut [MatchScore]) -> Result<(), ApiError> {
    if current.best_of <= 1 || step.match_type != MatchType::Duel || scores.len() != 2 {
        return Ok(());
    }
    let invalid = |message: String| ApiError::Validation(vec![("results", message)]);
    let (Some(a), Some(b)) = (scores[0].games_won, scores[1].games_won) else {
        return Err(invalid(format!(
            "Une série au meilleur de {} exige `games_won` pour chaque participant.",
            current.best_of
        )));
    };
    let (winner, loser) = if a > b { (0, 1) } else { (1, 0) };
    let (won, lost) = (
        scores[winner].games_won.unwrap_or(0),
        scores[loser].games_won.unwrap_or(0),
    );
    if !series_is_decided(current.best_of, won, lost) {
        return Err(invalid(format!(
            "Au meilleur de {}, le vainqueur compte {} manches et le perdant moins ({won}-{lost} reçu).",
            current.best_of,
            games_to_win(current.best_of)
        )));
    }
    scores[winner].rank = Some(1);
    scores[winner].result = Some(MatchResult::Win);
    scores[loser].rank = Some(2);
    scores[loser].result = Some(MatchResult::Loss);
    Ok(())
}

/// Barème de l'étape : remplace les points issus des statistiques, sans les additionner (pas de
/// double comptage dans le total de l'étape ni du tournoi).
fn apply_step_scoring(step: &Step, scores: &mut [MatchScore]) {
    let Some(scoring) = &step.rules.scoring else {
        return;
    };
    for score in scores {
        let points = match step.match_type {
            MatchType::Duel => match score.result {
                Some(MatchResult::Win) => Some(scoring.win),
                Some(MatchResult::Draw) => Some(scoring.draw),
                Some(MatchResult::Loss) => Some(scoring.loss),
                None => None,
            },
            MatchType::Ffa => score.rank.map(|rank| {
                usize::try_from(rank - 1)
                    .ok()
                    .and_then(|i| scoring.placement.get(i))
                    .copied()
                    .unwrap_or(0.0)
            }),
        };
        if let Some(points) = points {
            score.points = points;
        }
    }
}

/// Participants à placer dans les matchs suivants et matchs à annuler quand `current` se termine
/// (vainqueur, et perdant en double élimination). À la grande finale, la manche de « reset » est
/// annulée si le vainqueur du tableau des vainqueurs gagne ; sinon les deux finalistes y jouent.
async fn progression(
    state: &AppState,
    step: &Step,
    current: &Match,
    members: &[MatchParticipant],
    scores: &[MatchScore],
) -> Result<(Vec<Placement>, Vec<Uuid>), ApiError> {
    let Some(next_id) = current.next_match_id else {
        return Ok((Vec::new(), Vec::new()));
    };
    let winners: Vec<Uuid> = scores
        .iter()
        .filter(|s| s.result == Some(MatchResult::Win))
        .map(|s| s.participant_id)
        .collect();
    let [winner] = winners[..] else {
        return Err(ApiError::Validation(vec![(
            "results",
            "Un match d'élimination a un seul vainqueur (`win`).".to_string(),
        )]));
    };
    let loser = scores
        .iter()
        .map(|s| s.participant_id)
        .find(|id| *id != winner);
    let slot_of = |id: Uuid| {
        members
            .iter()
            .find(|m| m.participant_id == id)
            .and_then(|m| m.slot)
    };

    if current.bracket == Some(Bracket::GrandFinal) && current.loser_next_match_id == Some(next_id)
    {
        let reset = find_match(state, step, next_id).await?;
        if reset.status != MatchStatus::Scheduled {
            return Err(ApiError::InvalidTransition);
        }
        let winner_slot = usize::try_from(slot_of(winner).unwrap_or(1) - 1).unwrap_or(0);
        if grand_final_ends_tournament(winner_slot) {
            return Ok((Vec::new(), vec![next_id]));
        }
        let mut placements = vec![Placement {
            match_id: next_id,
            participant_id: winner,
            slot: slot_of(winner).or(Some(2)),
        }];
        if let Some(loser) = loser {
            placements.push(Placement {
                match_id: next_id,
                participant_id: loser,
                slot: slot_of(loser).or(Some(1)),
            });
        }
        return Ok((placements, Vec::new()));
    }

    let mut placements = Vec::new();
    check_open_slot(state, step, next_id, winner).await?;
    placements.push(Placement {
        match_id: next_id,
        participant_id: winner,
        slot: current.next_slot,
    });
    if let (Some(loser_next), Some(loser)) = (current.loser_next_match_id, loser) {
        check_open_slot(state, step, loser_next, loser).await?;
        placements.push(Placement {
            match_id: loser_next,
            participant_id: loser,
            slot: current.loser_next_slot,
        });
    }
    Ok((placements, Vec::new()))
}

/// Le match d'arrivée attend encore des participants et ne contient pas déjà celui-ci.
async fn check_open_slot(
    state: &AppState,
    step: &Step,
    next_id: Uuid,
    participant: Uuid,
) -> Result<(), ApiError> {
    let next = find_match(state, step, next_id).await?;
    let waiting = match_participants(state, step, next.id).await?;
    if next.status != MatchStatus::Scheduled
        || waiting.len() >= capacity(step)
        || waiting.iter().any(|p| p.participant_id == participant)
    {
        return Err(ApiError::InvalidTransition);
    }
    Ok(())
}

/// Clôture l'étape si tous ses matchs sont terminés ou annulés, avec au moins un match terminé
/// par groupe. Le match est déjà enregistré : un échec ici se journalise et l'étape se clôture
/// alors par `POST .../close`.
async fn close_if_complete(
    state: &AppState,
    tournament: &Tournament,
    step: &Step,
) -> Option<CloseResponse> {
    let complete = async {
        let groups = state.store.list_step_groups(step.id).await?;
        let matches = state.store.list_matches(step.id, None, None).await?;
        Ok::<_, StoreError>(is_complete(
            step,
            &groups.iter().map(|g| g.id).collect::<Vec<_>>(),
            &matches,
        ))
    }
    .await;
    match complete {
        Ok(true) => match close_step_of(state, tournament, step).await {
            Ok(closed) => Some(closed),
            Err(err) => {
                eprintln!(
                    "api-public : clôture automatique de l'étape {} : {err}",
                    step.id
                );
                None
            }
        },
        Ok(false) => None,
        Err(err) => {
            eprintln!(
                "api-public : clôture automatique de l'étape {} : {err}",
                step.id
            );
            None
        }
    }
}

/// Chaque groupe a au moins un match terminé et aucun match n'est encore à jouer.
fn is_complete(step: &Step, groups: &[Uuid], matches: &[Match]) -> bool {
    // Une étape suisse générée n'est terminée qu'après sa dernière ronde.
    if step.format == StepFormat::Swiss
        && matches.iter().any(|m| m.number.is_some())
        && matches.iter().filter_map(|m| m.round).max().unwrap_or(0) < step.matches_per_group
    {
        return false;
    }
    !groups.is_empty()
        && matches
            .iter()
            .all(|m| matches!(m.status, MatchStatus::Finished | MatchStatus::Cancelled))
        && groups.iter().all(|group| {
            matches
                .iter()
                .any(|m| m.group_id == Some(*group) && m.status == MatchStatus::Finished)
        })
}

async fn find_match(state: &AppState, step: &Step, match_id: Uuid) -> Result<Match, ApiError> {
    state
        .store
        .find_match(match_id)
        .await
        .map_err(ApiError::internal)?
        .filter(|m| m.step_id == step.id)
        .ok_or(ApiError::NotFound)
}

/// Participants de tous les matchs de l'étape.
async fn participants_in(state: &AppState, step: &Step) -> Result<Vec<MatchParticipant>, ApiError> {
    state
        .store
        .list_step_match_participants(step.id)
        .await
        .map_err(ApiError::internal)
}

async fn participants_by_match(
    state: &AppState,
    step: &Step,
) -> Result<HashMap<Uuid, Vec<MatchParticipant>>, ApiError> {
    let mut grouped: HashMap<Uuid, Vec<MatchParticipant>> = HashMap::new();
    for participant in participants_in(state, step).await? {
        grouped
            .entry(participant.match_id)
            .or_default()
            .push(participant);
    }
    Ok(grouped)
}

async fn match_participants(
    state: &AppState,
    step: &Step,
    match_id: Uuid,
) -> Result<Vec<MatchParticipant>, ApiError> {
    Ok(participants_in(state, step)
        .await?
        .into_iter()
        .filter(|p| p.match_id == match_id)
        .collect())
}

/// Les matchs donnés avec leurs participants.
pub(crate) async fn details_of(
    state: &AppState,
    step: &Step,
    found: Vec<Match>,
) -> Result<Vec<MatchDetail>, ApiError> {
    let mut by_match = participants_by_match(state, step).await?;
    Ok(found
        .into_iter()
        .map(|m| MatchDetail {
            participants: by_match.remove(&m.id).unwrap_or_default(),
            r#match: m,
        })
        .collect())
}

async fn detail_of(state: &AppState, step: &Step, found: Match) -> Result<MatchDetail, ApiError> {
    Ok(MatchDetail {
        participants: match_participants(state, step, found.id).await?,
        r#match: found,
    })
}

/// Statistiques du jeu du tournoi et barème du tournoi.
async fn scoring_of(
    state: &AppState,
    tournament: &Tournament,
) -> Result<(Vec<Stat>, Vec<ScoringRule>), ApiError> {
    let stats = state
        .store
        .list_game_stats(tournament.game_id)
        .await
        .map_err(ApiError::internal)?
        .unwrap_or_default();
    let rules = state
        .store
        .list_scoring_rules(tournament.id)
        .await
        .map_err(ApiError::internal)?;
    Ok((stats, rules))
}

fn require_ongoing(step: &Step) -> Result<(), ApiError> {
    if step.status == StepStatus::Ongoing {
        Ok(())
    } else {
        Err(ApiError::InvalidTransition)
    }
}

fn match_error(err: StoreError) -> ApiError {
    match err {
        StoreError::MatchState => ApiError::InvalidTransition,
        other => ApiError::internal(other),
    }
}

/// Nombre maximum de participants d'un match.
fn capacity(step: &Step) -> usize {
    capacity_of(step.match_type, step.group_size)
}

pub(crate) fn capacity_of(match_type: MatchType, group_size: i32) -> usize {
    match match_type {
        MatchType::Duel => 2,
        MatchType::Ffa => usize::try_from(group_size).unwrap_or(2),
    }
}

/// Ce qui empêche de jouer un match de `count` participants.
fn participants_problem(step: &Step, count: usize) -> Option<String> {
    playable_problem(step.match_type, step.group_size, count)
}

/// Ce qui empêche de jouer, pour une étape de ce type et de cette taille de groupe, un match de
/// `count` participants.
pub(crate) fn playable_problem(
    match_type: MatchType,
    group_size: i32,
    count: usize,
) -> Option<String> {
    let capacity = capacity_of(match_type, group_size);
    match match_type {
        MatchType::Duel if count != 2 => Some(format!(
            "Un match en duel oppose exactement 2 participants, il y en a {count}."
        )),
        MatchType::Ffa if !(2..=capacity).contains(&count) => Some(format!(
            "Un match en ffa réunit de 2 à {capacity} participants, il y en a {count}."
        )),
        _ => None,
    }
}

fn check_round(round: Option<i32>, errors: &mut Vec<(&'static str, String)>) -> Option<i32> {
    if let Some(round) = round
        && !(1..=ROUND_MAX).contains(&round)
    {
        errors.push((
            "round",
            format!("Un entier de 1 à {ROUND_MAX} est attendu."),
        ));
    }
    round
}

fn check_scheduled_at(
    value: Option<String>,
    errors: &mut Vec<(&'static str, String)>,
) -> Option<String> {
    let value = value?;
    let normalized = normalize_timestamp(&value);
    if normalized.is_none() {
        errors.push((
            "scheduled_at",
            "Un horodatage RFC 3339 en UTC (suffixe Z) est attendu.".to_string(),
        ));
    }
    normalized
}

fn check_bracket(step: &Step, bracket: Option<Bracket>, errors: &mut Vec<(&'static str, String)>) {
    if bracket.is_some() && step.format != StepFormat::DoubleElim {
        errors.push((
            "bracket",
            "Le tableau ne se précise qu'en double élimination.".to_string(),
        ));
    }
}

/// Le match suivant est un autre match de la même étape, en élimination, sans boucle.
async fn check_next(
    state: &AppState,
    step: &Step,
    current: Option<Uuid>,
    next: Uuid,
    errors: &mut Vec<(&'static str, String)>,
) -> Result<(), ApiError> {
    if !matches!(step.format, StepFormat::SingleElim | StepFormat::DoubleElim) {
        errors.push((
            "next_match_id",
            "Le vainqueur ne se propage qu'en élimination.".to_string(),
        ));
        return Ok(());
    }
    let matches = state
        .store
        .list_matches(step.id, None, None)
        .await
        .map_err(ApiError::internal)?;
    if !matches.iter().any(|m| m.id == next) {
        errors.push((
            "next_match_id",
            "Ce match n'appartient pas à l'étape.".to_string(),
        ));
        return Ok(());
    }
    // Suit la chaîne depuis le match suivant : elle ne doit pas revenir au match modifié.
    let mut cursor = Some(next);
    let mut hops = 0;
    while let Some(id) = cursor {
        if Some(id) == current || hops > matches.len() {
            errors.push((
                "next_match_id",
                "Le match suivant ne peut pas former une boucle.".to_string(),
            ));
            break;
        }
        cursor = matches
            .iter()
            .find(|m| m.id == id)
            .and_then(|m| m.next_match_id);
        hops += 1;
    }
    Ok(())
}

/// Les participants sont distincts, du groupe et pas plus nombreux que le match n'en accueille.
async fn check_participants(
    state: &AppState,
    step: &Step,
    group_id: Uuid,
    ids: &[Uuid],
    errors: &mut Vec<(&'static str, String)>,
) -> Result<(), ApiError> {
    let distinct: HashSet<&Uuid> = ids.iter().collect();
    if distinct.len() != ids.len() {
        errors.push((
            "participant_ids",
            "Un participant ne figure qu'une fois.".to_string(),
        ));
    }
    if ids.len() > capacity(step) {
        errors.push((
            "participant_ids",
            format!(
                "Ce match accueille {} participants au plus.",
                capacity(step)
            ),
        ));
    }
    let in_group: HashSet<Uuid> = state
        .store
        .list_step_participants(step.id)
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        .filter(|m| m.group_id == group_id)
        .map(|m| m.participant_id)
        .collect();
    if let Some(stranger) = ids.iter().find(|id| !in_group.contains(id)) {
        errors.push((
            "participant_ids",
            format!("{stranger} n'appartient pas à ce groupe."),
        ));
    }
    Ok(())
}

/// Valide les statistiques d'un participant et renvoie la valeur de chacune par clé (le `total`
/// d'une équipe détaillée par joueur).
///
/// Les clés sont celles des statistiques du jeu, avec une valeur numérique finie (0 à 100 pour un
/// pourcentage). Pour une équipe, `{"total": {...}, "players": {"<user_id>": {...}}}` détaille
/// chaque joueur, `total` comptant pour le barème.
pub(crate) fn parse_stats(
    value: &Value,
    known: &HashMap<String, StatType>,
) -> Result<HashMap<String, f64>, String> {
    let Some(object) = value.as_object() else {
        return Err("`stats` doit être un objet.".to_string());
    };
    let detailed = object.contains_key("total") && !known.contains_key("total");
    if !detailed {
        return flat_stats(object, known);
    }
    if let Some(extra) = object
        .keys()
        .find(|k| !matches!(k.as_str(), "total" | "players"))
    {
        return Err(format!(
            "clé « {extra} » inattendue : `total` et `players` seulement."
        ));
    }
    let total = object
        .get("total")
        .and_then(Value::as_object)
        .ok_or("`total` doit être un objet de statistiques.")?;
    let totals = flat_stats(total, known).map_err(|e| format!("total : {e}"))?;
    if let Some(players) = object.get("players") {
        let players = players
            .as_object()
            .ok_or("`players` doit associer un identifiant de joueur à ses statistiques.")?;
        for (player, stats) in players {
            if player.parse::<Uuid>().is_err() {
                return Err(format!("« {player} » n'est pas un identifiant de joueur."));
            }
            let stats = stats
                .as_object()
                .ok_or_else(|| format!("players : les statistiques de {player} sont un objet."))?;
            flat_stats(stats, known).map_err(|e| format!("players {player} : {e}"))?;
        }
    }
    Ok(totals)
}

fn flat_stats(
    object: &serde_json::Map<String, Value>,
    known: &HashMap<String, StatType>,
) -> Result<HashMap<String, f64>, String> {
    let mut values = HashMap::with_capacity(object.len());
    for (key, value) in object {
        let Some(kind) = known.get(key) else {
            return Err(format!("« {key} » n'est pas une statistique de ce jeu."));
        };
        let number = value
            .as_f64()
            .filter(|n| n.is_finite() && n.abs() <= STAT_VALUE_MAX)
            .ok_or_else(|| format!("« {key} » doit être un nombre."))?;
        if *kind == StatType::Percent && !(0.0..=100.0).contains(&number) {
            return Err(format!("« {key} » est un pourcentage de 0 à 100."));
        }
        values.insert(key.clone(), number);
    }
    Ok(values)
}

/// Points rapportés par les statistiques : la somme des règles du barème dont la statistique est
/// renseignée.
pub(crate) fn points_of(
    values: &HashMap<String, f64>,
    rules: &[ScoringRule],
    stats: &[Stat],
) -> f64 {
    rules
        .iter()
        .filter_map(|rule| {
            let stat = stats.iter().find(|s| s.id == rule.stat_id)?;
            values.get(&stat.key).map(|value| rule.points_for(*value))
        })
        .sum()
}

/// Résultats définitifs d'un match qui se termine : chaque participant a des statistiques ou un
/// rang ; sans aucun rang, ils sont déduits des points (les égalités le partagent) ; un résultat
/// absent vaut `win` pour la première place, `draw` si elle est partagée, `loss` sinon.
pub(crate) fn settle(members: &[MatchParticipant]) -> Result<Vec<MatchScore>, String> {
    let empty =
        |m: &MatchParticipant| m.rank.is_none() && m.stats.as_object().is_none_or(|o| o.is_empty());
    let missing: Vec<String> = members
        .iter()
        .filter(|m| empty(m))
        .map(|m| m.participant_id.to_string())
        .collect();
    if !missing.is_empty() {
        return Err(format!(
            "Ni statistiques ni rang pour : {}.",
            missing.join(", ")
        ));
    }
    let ranked = members.iter().filter(|m| m.rank.is_some()).count();
    let ranks: HashMap<Uuid, i32> = if ranked == 0 {
        crate::ranking::rank(
            members
                .iter()
                .map(|m| (m.participant_id, m.points))
                .collect(),
        )
        .into_iter()
        .map(|(rank, id, _)| (id, i32::try_from(rank).unwrap_or(i32::MAX)))
        .collect()
    } else if ranked == members.len() {
        members
            .iter()
            .filter_map(|m| m.rank.map(|rank| (m.participant_id, rank)))
            .collect()
    } else {
        return Err("Tous les participants ont un rang, ou aucun.".to_string());
    };
    let leaders = ranks.values().filter(|rank| **rank == 1).count();
    Ok(members
        .iter()
        .map(|m| {
            let rank = ranks.get(&m.participant_id).copied();
            let derived = match rank {
                Some(1) if leaders == 1 => MatchResult::Win,
                Some(1) => MatchResult::Draw,
                _ => MatchResult::Loss,
            };
            MatchScore {
                participant_id: m.participant_id,
                stats: m.stats.clone(),
                points: m.points,
                rank,
                result: Some(m.result.unwrap_or(derived)),
                games_won: m.games_won,
                slot: m.slot,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::ScoringMode;
    use serde_json::json;

    fn known() -> HashMap<String, StatType> {
        HashMap::from([
            ("placement".to_string(), StatType::Flat),
            ("kills".to_string(), StatType::Flat),
            ("accuracy".to_string(), StatType::Percent),
        ])
    }

    fn member(stats: Value, points: f64, rank: Option<i32>) -> MatchParticipant {
        MatchParticipant {
            match_id: Uuid::nil(),
            participant_id: Uuid::new_v4(),
            stats,
            points,
            rank,
            result: None,
            slot: None,
            games_won: None,
        }
    }

    #[test]
    fn stats_are_checked_against_the_game_statistics() {
        let totals = parse_stats(&json!({"placement": 2, "kills": 7.5}), &known()).unwrap();
        assert_eq!(totals["kills"], 7.5);
        assert!(parse_stats(&json!({}), &known()).unwrap().is_empty());
        for bad in [
            json!([1]),
            json!({"deaths": 3}),
            json!({"kills": "7"}),
            json!({"kills": null}),
            json!({"kills": 1e12}),
            json!({"accuracy": 101}),
            json!({"accuracy": -1}),
        ] {
            assert!(parse_stats(&bad, &known()).is_err(), "{bad}");
        }
        assert!(parse_stats(&json!({"accuracy": 100}), &known()).is_ok());
    }

    #[test]
    fn a_team_detail_counts_its_total() {
        let player = Uuid::new_v4().to_string();
        let detailed = json!({
            "total": {"kills": 12},
            "players": { player: {"kills": 5}, Uuid::new_v4().to_string(): {"kills": 7} },
        });
        assert_eq!(parse_stats(&detailed, &known()).unwrap()["kills"], 12.0);
        for bad in [
            json!({"total": {"kills": 1}, "extra": {}}),
            json!({"total": [1]}),
            json!({"total": {"kills": 1}, "players": {"not-a-uuid": {}}}),
            json!({"total": {"kills": 1}, "players": {Uuid::new_v4().to_string(): {"deaths": 1}}}),
            json!({"total": {"deaths": 1}}),
        ] {
            assert!(parse_stats(&bad, &known()).is_err(), "{bad}");
        }
    }

    #[test]
    fn points_follow_the_scoring_rules() {
        let stats = vec![
            Stat {
                id: Uuid::new_v4(),
                name: "Placement".into(),
                key: "placement".into(),
                kind: StatType::Flat,
            },
            Stat {
                id: Uuid::new_v4(),
                name: "Éliminations".into(),
                key: "kills".into(),
                kind: StatType::Flat,
            },
        ];
        let rule = |stat: &Stat, mode, coefficient, table| ScoringRule {
            id: Uuid::new_v4(),
            tournament_id: Uuid::nil(),
            stat_id: stat.id,
            mode,
            coefficient,
            points_table: table,
        };
        let rules = vec![
            rule(
                &stats[0],
                ScoringMode::Table,
                None,
                Some(json!({"1": 8, "2": 7})),
            ),
            rule(&stats[1], ScoringMode::Linear, Some(1.5), None),
        ];
        let values = HashMap::from([("placement".to_string(), 2.0), ("kills".to_string(), 4.0)]);
        assert_eq!(points_of(&values, &rules, &stats), 13.0);
        let only_kills = HashMap::from([("kills".to_string(), 2.0)]);
        assert_eq!(points_of(&only_kills, &rules, &stats), 3.0);
        assert_eq!(points_of(&HashMap::new(), &rules, &stats), 0.0);
    }

    #[test]
    fn finishing_derives_ranks_and_results_from_the_points() {
        let (a, b, c) = (
            member(json!({"kills": 1}), 5.0, None),
            member(json!({"kills": 2}), 9.0, None),
            member(json!({"kills": 1}), 5.0, None),
        );
        let scores = settle(&[a.clone(), b.clone(), c.clone()]).unwrap();
        let by_id = |id: Uuid| scores.iter().find(|s| s.participant_id == id).unwrap();
        assert_eq!(
            (by_id(b.participant_id).rank, by_id(b.participant_id).result),
            (Some(1), Some(MatchResult::Win))
        );
        assert_eq!(
            (by_id(a.participant_id).rank, by_id(a.participant_id).result),
            (Some(2), Some(MatchResult::Loss))
        );
        assert_eq!(by_id(c.participant_id).rank, Some(2));
    }

    #[test]
    fn a_shared_first_place_is_a_draw_and_a_given_result_wins() {
        let (a, b) = (
            member(json!({"kills": 1}), 3.0, None),
            member(json!({"kills": 1}), 3.0, None),
        );
        let scores = settle(&[a.clone(), b]).unwrap();
        assert!(scores.iter().all(|s| s.result == Some(MatchResult::Draw)));

        let mut forfeited = member(json!({}), 0.0, Some(2));
        forfeited.result = Some(MatchResult::Loss);
        let winner = member(json!({}), 0.0, Some(1));
        let scores = settle(&[forfeited.clone(), winner.clone()]).unwrap();
        let result = |id: Uuid| {
            scores
                .iter()
                .find(|s| s.participant_id == id)
                .unwrap()
                .result
        };
        assert_eq!(result(winner.participant_id), Some(MatchResult::Win));
        assert_eq!(result(forfeited.participant_id), Some(MatchResult::Loss));
    }

    #[test]
    fn finishing_refuses_missing_results_and_partial_ranks() {
        let done = member(json!({"kills": 1}), 1.0, None);
        let blank = member(json!({}), 0.0, None);
        let error = settle(&[done.clone(), blank.clone()]).unwrap_err();
        assert!(error.contains(&blank.participant_id.to_string()), "{error}");
        let ranked = member(json!({}), 0.0, Some(1));
        assert!(settle(&[done, ranked]).is_err());
    }

    fn step(match_type: MatchType, group_size: i32) -> Step {
        Step {
            id: Uuid::nil(),
            tournament_id: Uuid::nil(),
            position: 1,
            format: StepFormat::Pool,
            match_type,
            group_count: 1,
            group_size,
            matches_per_group: 1,
            advance_per_group: 1,
            tiebreak: json!([]),
            rules: crate::store::StepRules::default(),
            status: StepStatus::Ongoing,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn the_participant_count_follows_the_match_type() {
        let duel = step(MatchType::Duel, 8);
        assert!(participants_problem(&duel, 2).is_none());
        assert!(participants_problem(&duel, 1).is_some());
        assert!(participants_problem(&duel, 3).is_some());
        let ffa = step(MatchType::Ffa, 8);
        assert!(participants_problem(&ffa, 2).is_none());
        assert!(participants_problem(&ffa, 8).is_none());
        assert!(participants_problem(&ffa, 1).is_some());
        assert!(participants_problem(&ffa, 9).is_some());
    }

    fn pool() -> Step {
        step(MatchType::Duel, 8)
    }

    fn scheduled(group: Uuid, status: MatchStatus) -> Match {
        Match {
            id: Uuid::new_v4(),
            game_id: Uuid::nil(),
            step_id: Uuid::nil(),
            group_id: Some(group),
            round: None,
            bracket: None,
            next_match_id: None,
            number: None,
            next_slot: None,
            loser_next_match_id: None,
            loser_next_slot: None,
            best_of: 1,
            scheduled_at: None,
            started_at: None,
            ended_at: None,
            status,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn a_step_is_complete_when_every_group_has_finished_all_its_matches() {
        let (g1, g2) = (Uuid::new_v4(), Uuid::new_v4());
        let finished = |g| scheduled(g, MatchStatus::Finished);
        assert!(is_complete(
            &pool(),
            &[g1, g2],
            &[finished(g1), finished(g2)]
        ));
        // Un match annulé ne bloque pas, un match à jouer si.
        assert!(is_complete(
            &pool(),
            &[g1],
            &[finished(g1), scheduled(g1, MatchStatus::Cancelled)]
        ));
        assert!(!is_complete(
            &pool(),
            &[g1],
            &[finished(g1), scheduled(g1, MatchStatus::Ongoing)]
        ));
        // Un groupe sans match terminé n'est pas joué.
        assert!(!is_complete(&pool(), &[g1, g2], &[finished(g1)]));
        assert!(!is_complete(
            &pool(),
            &[g1],
            &[scheduled(g1, MatchStatus::Cancelled)]
        ));
        assert!(!is_complete(&pool(), &[], &[]));
    }
}
