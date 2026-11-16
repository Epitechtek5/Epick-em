//! Pronostics de match et classements des spectateurs.
//!
//! Tout compte connecté pronostique les matchs d'un tournoi, local ou importé : le vainqueur
//! d'un duel (`winner_id`) ou le classement d'un FFA (`ranking`). Le pronostic se modifie et se
//! supprime jusqu'au **verrouillage**, décidé par l'horloge du serveur seule (ADR-002, règle 1) :
//! le match est lancé, terminé ou annulé, ou son heure prévue est passée. Les pronostics des
//! autres ne sont visibles qu'après le verrouillage.
//!
//! Les points sont attribués par la résolution ([`resolution`](crate::resolution)), lancée par
//! api-internal, puis additionnés dans les classements (`/tournaments/{id}/leaderboard` et
//! `/leaderboard`).

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::store::{
    LeaderboardEntry, Match, MatchParticipant, MatchStatus, MatchType, Prediction, PredictionInput,
    Step, Tournament, now_rfc3339,
};
use crate::tournaments::find_tournament;
use actix_web::{HttpResponse, delete, get, put, web};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use utoipa::{IntoParams, ToSchema};
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

const DEFAULT_PAGE_SIZE: i64 = 50;
const MAX_PAGE_SIZE: i64 = 100;

/// Routes des pronostics et des classements, avec leur documentation OpenAPI.
pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(get_prediction)
        .service(put_prediction)
        .service(delete_prediction)
        .service(match_predictions)
        .service(my_predictions)
        .service(tournament_leaderboard)
        .service(global_leaderboard);
}

/// Écritures qui ne touchent que des données des spectateurs (pronostics, Pick'em) : permises
/// sur un tournoi importé, et sans effet sur les exports en cache.
pub(crate) fn spectator_owned(path: &str) -> bool {
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
    matches!(
        segments.as_slice(),
        ["tournaments", _, "matches", _, "prediction"] | ["tournaments", _, "pickem", ..]
    )
}

/// Pronostic : le vainqueur d'un duel ou le classement d'un FFA, l'un des deux seulement.
#[derive(Deserialize, ToSchema)]
struct PredictionRequest {
    /// Inscrit pronostiqué vainqueur, participant du match (duel).
    winner_id: Option<Uuid>,
    /// Inscrits du match dans l'ordre pronostiqué, du premier au dernier (FFA) ; au moins un,
    /// distincts.
    ranking: Option<Vec<Uuid>>,
}

/// Un pronostic avec l'état du match.
#[derive(Serialize, ToSchema)]
struct PredictionView {
    #[serde(flatten)]
    #[schema(inline)]
    prediction: Prediction,
    /// Le pronostic ne peut plus changer.
    locked: bool,
}

/// Pronostics d'un match. Avant le verrouillage, seul leur nombre est connu.
#[derive(Serialize, ToSchema)]
struct MatchPredictions {
    locked: bool,
    count: usize,
    /// Nombre de pronostics par vainqueur choisi (duel), ou par premier du classement (FFA) ;
    /// vide avant le verrouillage.
    #[schema(value_type = Object, example = json!({"7c0e…": 12}))]
    distribution: HashMap<Uuid, usize>,
    /// Pronostics de chacun, avec son nom ; vide avant le verrouillage.
    predictions: Vec<NamedPrediction>,
}

#[derive(Serialize, ToSchema)]
struct NamedPrediction {
    #[serde(flatten)]
    #[schema(inline)]
    prediction: Prediction,
    username: Option<String>,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct MyPredictionsQuery {
    /// Ne renvoie que les pronostics de ce tournoi.
    tournament_id: Option<Uuid>,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct Pagination {
    /// Nombre de lignes renvoyées (1 à 100, 50 par défaut).
    limit: Option<i64>,
    /// Nombre de lignes ignorées (0 par défaut).
    offset: Option<i64>,
}

/// Ligne d'un classement des spectateurs.
#[derive(Serialize, ToSchema)]
struct LeaderboardRow {
    /// Rang ; les ex æquo partagent le même (1, 2, 2, 4).
    rank: i64,
    user_id: Uuid,
    username: Option<String>,
    points: f64,
    /// Pronostics et réponses justes, même en partie.
    correct: i64,
    /// Pronostics et réponses tranchés.
    resolved: i64,
}

/// Match d'un tournoi avec son étape et ses participants ; `404` s'il n'est pas de ce tournoi.
pub(crate) async fn tournament_match(
    state: &AppState,
    tournament_id: Uuid,
    match_id: Uuid,
) -> Result<(Match, Step, Vec<MatchParticipant>), ApiError> {
    let found = state
        .store
        .find_match(match_id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    let step = state
        .store
        .find_step(found.step_id)
        .await
        .map_err(ApiError::internal)?
        .filter(|step| step.tournament_id == tournament_id)
        .ok_or(ApiError::NotFound)?;
    let participants = state
        .store
        .list_step_match_participants(step.id)
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        .filter(|p| p.match_id == match_id)
        .collect();
    Ok((found, step, participants))
}

/// Le pronostic du match est-il verrouillé ? Seule l'horloge du serveur compte.
pub(crate) fn is_locked(found: &Match, tournament: &Tournament, now: &str) -> bool {
    use crate::store::TournamentStatus::{Cancelled, Finished};
    found.status != MatchStatus::Scheduled
        || found.started_at.is_some()
        || found.scheduled_at.as_deref().is_some_and(|at| at <= now)
        || matches!(tournament.status, Finished | Cancelled)
}

fn validate(
    request: PredictionRequest,
    step: &Step,
    participants: &[MatchParticipant],
) -> Result<(Option<Uuid>, Option<Vec<Uuid>>), ApiError> {
    let ids: HashSet<Uuid> = participants.iter().map(|p| p.participant_id).collect();
    if ids.len() < 2 {
        return Err(ApiError::Validation(vec![(
            "match",
            "Les participants du match ne sont pas encore connus.".into(),
        )]));
    }
    match (step.match_type, request.winner_id, request.ranking) {
        (MatchType::Duel, Some(winner), None) => {
            if ids.contains(&winner) {
                Ok((Some(winner), None))
            } else {
                Err(ApiError::Validation(vec![(
                    "winner_id",
                    "Ce participant ne joue pas ce match.".into(),
                )]))
            }
        }
        (MatchType::Duel, _, _) => Err(ApiError::Validation(vec![(
            "winner_id",
            "Un duel se pronostique avec winner_id seul.".into(),
        )])),
        (MatchType::Ffa, None, Some(ranking)) => {
            let distinct: HashSet<&Uuid> = ranking.iter().collect();
            if ranking.is_empty() || distinct.len() != ranking.len() {
                return Err(ApiError::Validation(vec![(
                    "ranking",
                    "Le classement compte au moins un participant, sans doublon.".into(),
                )]));
            }
            if !ranking.iter().all(|id| ids.contains(id)) {
                return Err(ApiError::Validation(vec![(
                    "ranking",
                    "Le classement ne compte que des participants du match.".into(),
                )]));
            }
            Ok((None, Some(ranking)))
        }
        (MatchType::Ffa, _, _) => Err(ApiError::Validation(vec![(
            "ranking",
            "Un match à plusieurs se pronostique avec ranking seul.".into(),
        )])),
    }
}

/// Mon pronostic sur un match.
#[utoipa::path(
    get,
    path = "/tournaments/{id}/matches/{match_id}/prediction",
    tag = "predictions",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("match_id" = Uuid, Path, description = "Identifiant du match"),
    ),
    responses(
        (status = 200, description = "Mon pronostic", body = PredictionView),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi, match ou pronostic introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/matches/{match_id}/prediction")]
async fn get_prediction(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, match_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let (found, _, _) = tournament_match(&state, tournament_id, match_id).await?;
    let prediction = state
        .store
        .pickem()
        .find_prediction(claims.sub, match_id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(PredictionView {
        prediction,
        locked: is_locked(&found, &tournament, &now_rfc3339()),
    }))
}

/// Crée ou remplace mon pronostic sur un match, tant qu'il n'est pas verrouillé.
#[utoipa::path(
    put,
    path = "/tournaments/{id}/matches/{match_id}/prediction",
    tag = "predictions",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("match_id" = Uuid, Path, description = "Identifiant du match"),
    ),
    request_body = PredictionRequest,
    responses(
        (status = 200, description = "Pronostic enregistré", body = PredictionView),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi ou match introuvable", body = ErrorResponse),
        (status = 409, description = "Match commencé : pronostic verrouillé", body = ErrorResponse),
    ),
)]
#[put("/tournaments/{id}/matches/{match_id}/prediction")]
async fn put_prediction(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
    body: web::Json<PredictionRequest>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, match_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let (found, step, participants) = tournament_match(&state, tournament_id, match_id).await?;
    if is_locked(&found, &tournament, &now_rfc3339()) {
        return Err(ApiError::PredictionLocked);
    }
    let (winner_id, ranking) = validate(body.into_inner(), &step, &participants)?;
    let prediction = state
        .store
        .pickem()
        .upsert_prediction(PredictionInput {
            user_id: claims.sub,
            tournament_id,
            match_id,
            winner_id,
            ranking,
        })
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok().json(PredictionView {
        prediction,
        locked: false,
    }))
}

/// Supprime mon pronostic sur un match, tant qu'il n'est pas verrouillé.
#[utoipa::path(
    delete,
    path = "/tournaments/{id}/matches/{match_id}/prediction",
    tag = "predictions",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("match_id" = Uuid, Path, description = "Identifiant du match"),
    ),
    responses(
        (status = 204, description = "Pronostic supprimé"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi, match ou pronostic introuvable", body = ErrorResponse),
        (status = 409, description = "Match commencé : pronostic verrouillé", body = ErrorResponse),
    ),
)]
#[delete("/tournaments/{id}/matches/{match_id}/prediction")]
async fn delete_prediction(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, match_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let (found, _, _) = tournament_match(&state, tournament_id, match_id).await?;
    if is_locked(&found, &tournament, &now_rfc3339()) {
        return Err(ApiError::PredictionLocked);
    }
    let deleted = state
        .store
        .pickem()
        .delete_prediction(claims.sub, match_id)
        .await
        .map_err(ApiError::internal)?;
    if deleted {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

/// Pronostics de tous les spectateurs sur un match : leur nombre avant le verrouillage, le
/// détail et la répartition après.
#[utoipa::path(
    get,
    path = "/tournaments/{id}/matches/{match_id}/predictions",
    tag = "predictions",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("match_id" = Uuid, Path, description = "Identifiant du match"),
    ),
    responses(
        (status = 200, description = "Pronostics du match", body = MatchPredictions),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi ou match introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/matches/{match_id}/predictions")]
async fn match_predictions(
    state: web::Data<AppState>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, match_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let (found, _, _) = tournament_match(&state, tournament_id, match_id).await?;
    let all = state
        .store
        .pickem()
        .list_match_predictions(match_id)
        .await
        .map_err(ApiError::internal)?;
    let locked = is_locked(&found, &tournament, &now_rfc3339());
    let count = all.len();
    if !locked {
        return Ok(HttpResponse::Ok().json(MatchPredictions {
            locked,
            count,
            distribution: HashMap::new(),
            predictions: Vec::new(),
        }));
    }
    let mut distribution: HashMap<Uuid, usize> = HashMap::new();
    for prediction in &all {
        let first = prediction
            .winner_id
            .or_else(|| prediction.ranking.as_ref().and_then(|r| r.first().copied()));
        if let Some(first) = first {
            *distribution.entry(first).or_default() += 1;
        }
    }
    let names = usernames(&state, all.iter().map(|p| p.user_id)).await?;
    let predictions = all
        .into_iter()
        .map(|prediction| NamedPrediction {
            username: names.get(&prediction.user_id).cloned(),
            prediction,
        })
        .collect();
    Ok(HttpResponse::Ok().json(MatchPredictions {
        locked,
        count,
        distribution,
        predictions,
    }))
}

/// Mes pronostics, du plus récent au plus ancien, éventuellement d'un seul tournoi.
#[utoipa::path(
    get,
    path = "/predictions",
    tag = "predictions",
    security(("bearer" = [])),
    params(MyPredictionsQuery),
    responses(
        (status = 200, description = "Mes pronostics", body = Vec<Prediction>),
        (status = 400, description = "Paramètres invalides", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
    ),
)]
#[get("/predictions")]
async fn my_predictions(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    query: web::Query<MyPredictionsQuery>,
) -> Result<HttpResponse, ApiError> {
    let predictions = state
        .store
        .pickem()
        .list_user_predictions(claims.sub, query.tournament_id)
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok().json(predictions))
}

/// Classement des spectateurs d'un tournoi : points des pronostics et du Pick'em.
#[utoipa::path(
    get,
    path = "/tournaments/{id}/leaderboard",
    tag = "predictions",
    security(("bearer" = [])),
    params(("id" = Uuid, Path, description = "Identifiant du tournoi"), Pagination),
    responses(
        (status = 200, description = "Classement", body = Vec<LeaderboardRow>),
        (status = 400, description = "Paramètres invalides", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/leaderboard")]
async fn tournament_leaderboard(
    state: web::Data<AppState>,
    id: web::Path<Uuid>,
    page: web::Query<Pagination>,
) -> Result<HttpResponse, ApiError> {
    find_tournament(&state, *id).await?;
    leaderboard(&state, Some(*id), &page).await
}

/// Classement général des spectateurs, tous tournois confondus.
#[utoipa::path(
    get,
    path = "/leaderboard",
    tag = "predictions",
    security(("bearer" = [])),
    params(Pagination),
    responses(
        (status = 200, description = "Classement", body = Vec<LeaderboardRow>),
        (status = 400, description = "Paramètres invalides", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
    ),
)]
#[get("/leaderboard")]
async fn global_leaderboard(
    state: web::Data<AppState>,
    page: web::Query<Pagination>,
) -> Result<HttpResponse, ApiError> {
    leaderboard(&state, None, &page).await
}

async fn leaderboard(
    state: &AppState,
    tournament_id: Option<Uuid>,
    page: &Pagination,
) -> Result<HttpResponse, ApiError> {
    let limit = page
        .limit
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let offset = page.offset.unwrap_or(0).max(0);
    let entries = state
        .store
        .pickem()
        .leaderboard(tournament_id, limit, offset)
        .await
        .map_err(ApiError::internal)?;
    let names = usernames(state, entries.iter().map(|e| e.user_id)).await?;
    let rows: Vec<LeaderboardRow> = entries
        .into_iter()
        .map(|entry: LeaderboardEntry| LeaderboardRow {
            rank: entry.rank,
            username: names.get(&entry.user_id).cloned(),
            user_id: entry.user_id,
            points: entry.points,
            correct: entry.correct,
            resolved: entry.resolved,
        })
        .collect();
    Ok(HttpResponse::Ok().json(rows))
}

/// Noms des comptes donnés (profils en cache) ; un compte supprimé n'a pas de nom.
async fn usernames(
    state: &AppState,
    ids: impl Iterator<Item = Uuid>,
) -> Result<HashMap<Uuid, String>, ApiError> {
    let mut names = HashMap::new();
    for id in ids.collect::<HashSet<_>>() {
        if let Some(profile) = state
            .store
            .find_profile(id)
            .await
            .map_err(ApiError::internal)?
        {
            names.insert(id, profile.username);
        }
    }
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spectator_paths() {
        assert!(spectator_owned("/tournaments/x/matches/y/prediction"));
        assert!(spectator_owned("/tournaments/x/pickem/questions/q/answer"));
        assert!(spectator_owned("/tournaments/x/pickem/questions"));
        assert!(!spectator_owned("/tournaments/x/steps/s/matches/y"));
        assert!(!spectator_owned("/tournaments/x"));
    }
}
