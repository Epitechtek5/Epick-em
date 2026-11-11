//! Parties d'un match (`match_game`) : série BO1, BO3 ou BO5, résultats de chaque partie et
//! agrégation dans le résultat du match.
//!
//! Un match créé avec `best_of` > 1, ou qui a au moins une partie, ne se saisit plus
//! directement (`PUT .../results`, `POST .../status` avec `finished`) : le backend déduit son
//! résultat des parties terminées, puis réutilise la clôture d'un match existante (rangs,
//! points de l'étape, propagation du vainqueur, clôture de l'étape). Un match sans partie et
//! avec `best_of` = 1 reste saisi directement : c'est le cas des matchs historiques.
//!
//! Chaque partie garde, par participant, les statistiques numériques (qui seules entrent dans
//! le barème), les choix (`select` de portée `participant`, ex. le personnage) et, au niveau de
//! la partie, des attributs (`select` de portée `match`, ex. la carte, et MVP). La série se
//! termine dès qu'un participant a gagné la majorité des parties (2 en BO3, 3 en BO5) ou que
//! toutes les parties sont jouées. Une partie terminée ne change plus.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::matches::{
    MatchDetail, StatSchema, close_if_complete, commit_finish, detail_of, find_match, match_error,
    match_participants, participants_problem, players_of, points_of, require_ongoing, scoring_of,
    settle,
};
use crate::steps::{CloseResponse, find_step};
use crate::store::{
    GameFinish, GameScores, Match, MatchGame, MatchGameParticipant, MatchParticipant, MatchResult,
    MatchScore, MatchStatus, StatType,
};
use crate::tournaments::find_tournament;
use crate::users::require_admin;
use actix_web::{HttpResponse, delete, get, post, put, web};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use utoipa::ToSchema;
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

/// Routes des parties, avec leur documentation OpenAPI.
pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(list_games)
        .service(get_game)
        .service(create_game)
        .service(save_game_results)
        .service(finish_game)
        .service(delete_game);
}

#[derive(Deserialize, ToSchema)]
struct CreateGameRequest {
    /// Attributs de la partie par clé de statistique de portée `match` : une option pour un
    /// `select` (ex. la carte), un participant ou joueur pour un MVP.
    #[schema(value_type = Option<Object>, example = json!({"map": "ascent"}))]
    attributes: Option<Value>,
}

/// Résultats à enregistrer ; ceux des participants non listés ne changent pas.
#[derive(Deserialize, ToSchema)]
struct GameResultsRequest {
    /// Remplace les attributs de la partie s'il est présent.
    #[schema(value_type = Option<Object>, example = json!({"map": "ascent"}))]
    attributes: Option<Value>,
    #[serde(default)]
    results: Vec<GameResultEntry>,
}

/// Résultat d'un participant dans la partie. Il remplace le précédent.
#[derive(Deserialize, ToSchema)]
struct GameResultEntry {
    /// Inscrit au tournoi (`tournament_participant.id`), participant du match.
    participant_id: Uuid,
    /// Valeur de chaque statistique du jeu de portée `participant`, par clé : un nombre pour une
    /// statistique numérique, la clé d'une option pour un `select`. Pour une équipe,
    /// `{"total": {...}, "players": {"<user_id>": {...}}}`.
    #[schema(value_type = Object, example = json!({"kills": 7, "character": "jett"}))]
    stats: Value,
    /// Place dans la partie, de 1 au nombre de participants. Calculée d'après les points si
    /// aucun participant n'en a, à la fin de la partie.
    #[schema(minimum = 1)]
    rank: Option<i32>,
    /// `win` pour la première place, `loss` sinon, `draw` en cas d'égalité en tête, si absent à
    /// la fin de la partie.
    result: Option<MatchResult>,
}

/// Résultat de la fin d'une partie.
#[derive(Serialize, ToSchema)]
struct GameOutcome {
    game: MatchGame,
    /// Le match, avec ses résultats agrégés s'il vient de se terminer.
    #[serde(rename = "match")]
    #[schema(inline)]
    match_detail: MatchDetail,
    /// `true` quand cette partie a décidé la série : le match est alors `finished`.
    series_finished: bool,
    /// Renseigné quand ce match était le dernier de l'étape, qui s'est alors clôturée.
    step_closed: Option<CloseResponse>,
}

/// Parties du match, par numéro, avec les résultats de leurs participants.
#[utoipa::path(
    get,
    path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}/games",
    tag = "match-games",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
        ("match_id" = Uuid, Path, description = "Identifiant du match"),
    ),
    responses(
        (status = 200, description = "Les parties du match (vide pour un match saisi directement)", body = Vec<MatchGame>),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi, étape ou match introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/steps/{step_id}/matches/{match_id}/games")]
async fn list_games(
    state: web::Data<AppState>,
    path: web::Path<(Uuid, Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, step_id, match_id) = path.into_inner();
    find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    let found = find_match(&state, &step, match_id).await?;
    Ok(HttpResponse::Ok().json(games_of(&state, found.id).await?))
}

/// Détail d'une partie.
#[utoipa::path(
    get,
    path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}/games/{number}",
    tag = "match-games",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
        ("match_id" = Uuid, Path, description = "Identifiant du match"),
        ("number" = i32, Path, description = "Numéro de la partie, à partir de 1"),
    ),
    responses(
        (status = 200, description = "La partie", body = MatchGame),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 404, description = "Tournoi, étape, match ou partie introuvable", body = ErrorResponse),
    ),
)]
#[get("/tournaments/{id}/steps/{step_id}/matches/{match_id}/games/{number}")]
async fn get_game(
    state: web::Data<AppState>,
    path: web::Path<(Uuid, Uuid, Uuid, i32)>,
) -> Result<HttpResponse, ApiError> {
    let (tournament_id, step_id, match_id, number) = path.into_inner();
    find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    let found = find_match(&state, &step, match_id).await?;
    Ok(HttpResponse::Ok().json(find_game(&state, found.id, number).await?))
}

/// Ouvre la partie suivante d'un match `scheduled` ou `ongoing` (administrateur).
///
/// Le match passe en `ongoing` s'il ne l'était pas ; la partie reprend ses participants, qui
/// doivent être au bon nombre. Une seule partie est ouverte à la fois, et jamais plus que
/// `best_of` : terminez la précédente d'abord.
#[utoipa::path(
    post,
    path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}/games",
    tag = "match-games",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
        ("match_id" = Uuid, Path, description = "Identifiant du match"),
    ),
    request_body = CreateGameRequest,
    responses(
        (status = 201, description = "Partie ouverte", body = MatchGame),
        (status = 400, description = "Attributs ou participants invalides", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi, étape ou match introuvable", body = ErrorResponse),
        (status = 409, description = "Étape non en cours, match terminé ou annulé, partie précédente non terminée ou série complète", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/steps/{step_id}/matches/{match_id}/games")]
async fn create_game(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid, Uuid)>,
    body: web::Json<CreateGameRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, step_id, match_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    let current = find_match(&state, &step, match_id).await?;
    require_ongoing(&step)?;
    require_open(&current)?;
    let members = match_participants(&state, &step, current.id).await?;
    if let Some(problem) = participants_problem(&step, members.len()) {
        return Err(ApiError::Validation(vec![("participants", problem)]));
    }
    let games = games_of(&state, current.id).await?;
    if games.len() >= usize::try_from(current.best_of).unwrap_or(1) {
        return Err(ApiError::InvalidTransition);
    }
    let attributes = body.into_inner().attributes.unwrap_or_else(|| json!({}));
    let (stats, _) = scoring_of(&state, &tournament).await?;
    let designated: HashSet<Uuid> = members.iter().map(|m| m.participant_id).collect();
    if let Err(problem) = StatSchema::new(&stats).check_attributes(&attributes, &designated) {
        return Err(ApiError::Validation(vec![("attributes", problem)]));
    }
    let game = state
        .store
        .create_match_game(current.id, attributes)
        .await
        .map_err(match_error)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Created().json(game))
}

/// Enregistre les attributs et les statistiques des participants d'une partie en cours
/// (administrateur) et calcule leurs points d'après le barème du tournoi.
///
/// Les statistiques numériques seules entrent dans le barème ; les choix (`select`) et les
/// attributs (carte, MVP) sont validés d'après les options du jeu et les participants du match.
/// La partie se termine par `POST .../finish`.
#[utoipa::path(
    put,
    path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}/games/{number}/results",
    tag = "match-games",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
        ("match_id" = Uuid, Path, description = "Identifiant du match"),
        ("number" = i32, Path, description = "Numéro de la partie, à partir de 1"),
    ),
    request_body = GameResultsRequest,
    responses(
        (status = 200, description = "Résultats enregistrés", body = MatchGame),
        (status = 400, description = "Statistiques, options ou attributs invalides", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi, étape, match ou partie introuvable", body = ErrorResponse),
        (status = 409, description = "Étape non en cours, ou partie ou match terminé", body = ErrorResponse),
    ),
)]
#[put("/tournaments/{id}/steps/{step_id}/matches/{match_id}/games/{number}/results")]
async fn save_game_results(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid, Uuid, i32)>,
    body: web::Json<GameResultsRequest>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, step_id, match_id, number) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    let current = find_match(&state, &step, match_id).await?;
    require_ongoing(&step)?;
    require_open(&current)?;
    let game = find_game(&state, current.id, number).await?;
    require_game_ongoing(&game)?;
    let request = body.into_inner();
    let (stats, rules) = scoring_of(&state, &tournament).await?;
    let schema = StatSchema::new(&stats);

    let mut errors = Vec::new();
    if request.results.is_empty() && request.attributes.is_none() {
        errors.push((
            "results",
            "Au moins un résultat ou des attributs sont attendus.".to_string(),
        ));
    }
    let count = game.participants.len();
    let mut seen = HashSet::new();
    let mut scores = Vec::with_capacity(request.results.len());
    for entry in request.results {
        let id = entry.participant_id;
        if !game.participants.iter().any(|p| p.participant_id == id) {
            errors.push(("results", format!("{id} ne participe pas à cette partie.")));
            continue;
        }
        if !seen.insert(id) {
            errors.push(("results", format!("{id} apparaît plusieurs fois.")));
            continue;
        }
        if let Some(rank) = entry.rank
            && !(1..=i32::try_from(count).unwrap_or(i32::MAX)).contains(&rank)
        {
            errors.push((
                "results",
                format!("Le rang de {id} doit aller de 1 à {count} (nombre de participants)."),
            ));
            continue;
        }
        match schema.parse(&entry.stats) {
            Ok(totals) => scores.push(MatchScore {
                participant_id: id,
                points: points_of(&totals, &rules, &stats),
                stats: entry.stats,
                rank: entry.rank,
                result: entry.result,
            }),
            Err(problem) => errors.push(("results", format!("{id} : {problem}"))),
        }
    }
    if let Some(attributes) = &request.attributes {
        // Un MVP désigne un participant du match ou un joueur détaillé dans les statistiques
        // de la partie (celles qui viennent d'être envoyées, sinon celles déjà enregistrées).
        let mut designated: HashSet<Uuid> =
            game.participants.iter().map(|p| p.participant_id).collect();
        for member in &game.participants {
            let current_stats = scores
                .iter()
                .find(|s| s.participant_id == member.participant_id)
                .map_or(&member.stats, |s| &s.stats);
            designated.extend(players_of(current_stats));
        }
        if let Err(problem) = schema.check_attributes(attributes, &designated) {
            errors.push(("attributes", problem));
        }
    }
    if !errors.is_empty() {
        return Err(ApiError::Validation(errors));
    }
    let saved = state
        .store
        .save_game_scores(GameScores {
            game_id: game.id,
            attributes: request.attributes,
            scores,
        })
        .await
        .map_err(match_error)?
        .ok_or(ApiError::NotFound)?;
    Ok(HttpResponse::Ok().json(saved))
}

/// Termine une partie en cours (administrateur) et, si elle décide la série, le match.
///
/// Chaque participant doit avoir des statistiques ou un rang ; les rangs et résultats absents
/// sont déduits des points. Dès qu'un participant a gagné la majorité des parties (ou que
/// toutes sont jouées), le match se termine avec les statistiques et les points cumulés des
/// parties, un rang d'après les parties gagnées, et les mécanismes habituels : points de
/// l'étape, vainqueur placé dans le match suivant, clôture de l'étape.
#[utoipa::path(
    post,
    path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}/games/{number}/finish",
    tag = "match-games",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
        ("match_id" = Uuid, Path, description = "Identifiant du match"),
        ("number" = i32, Path, description = "Numéro de la partie, à partir de 1"),
    ),
    responses(
        (status = 200, description = "Partie terminée, avec le match", body = GameOutcome),
        (status = 400, description = "Résultats incomplets ou vainqueur ambigu en élimination", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi, étape, match ou partie introuvable", body = ErrorResponse),
        (status = 409, description = "Étape non en cours, partie ou match terminé, ou match suivant indisponible", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/steps/{step_id}/matches/{match_id}/games/{number}/finish")]
async fn finish_game(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid, Uuid, i32)>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, step_id, match_id, number) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    let current = find_match(&state, &step, match_id).await?;
    require_ongoing(&step)?;
    require_open(&current)?;
    let game = find_game(&state, current.id, number).await?;
    require_game_ongoing(&game)?;

    let members: Vec<MatchParticipant> = game
        .participants
        .iter()
        .map(|p| MatchParticipant {
            match_id: game.id,
            participant_id: p.participant_id,
            stats: p.stats.clone(),
            points: p.points,
            rank: p.rank,
            result: p.result,
        })
        .collect();
    let scores =
        settle(&members).map_err(|problem| ApiError::Validation(vec![("results", problem)]))?;

    let mut games = games_of(&state, current.id).await?;
    if let Some(slot) = games.iter_mut().find(|g| g.id == game.id) {
        slot.status = MatchStatus::Finished;
        slot.participants = scores.iter().cloned().map(game_participant).collect();
    }
    let finish = GameFinish {
        game_id: game.id,
        scores,
    };
    if !is_decided(current.best_of, &games) {
        let saved = state
            .store
            .finish_game(finish)
            .await
            .map_err(match_error)?
            .ok_or(ApiError::NotFound)?;
        return Ok(HttpResponse::Ok().json(GameOutcome {
            game: saved,
            match_detail: detail_of(&state, &step, current).await?,
            series_finished: false,
            step_closed: None,
        }));
    }

    let (stats, _) = scoring_of(&state, &tournament).await?;
    let kinds: HashMap<String, StatType> = stats
        .iter()
        .filter(|s| s.kind.is_numeric())
        .map(|s| (s.key.clone(), s.kind))
        .collect();
    let ids: Vec<Uuid> = members.iter().map(|m| m.participant_id).collect();
    let totals = aggregate(&games, &ids, &kinds);
    let aggregated =
        settle(&totals).map_err(|problem| ApiError::Validation(vec![("results", problem)]))?;
    let finished = commit_finish(&state, &step, &current, aggregated, Some(finish)).await?;
    let step_closed = close_if_complete(&state, &tournament, &step).await;
    let step = match &step_closed {
        Some(closed) => closed.step.clone(),
        None => step,
    };
    let saved = find_game(&state, finished.id, number).await?;
    Ok(HttpResponse::Ok().json(GameOutcome {
        game: saved,
        match_detail: detail_of(&state, &step, finished).await?,
        series_finished: true,
        step_closed,
    }))
}

/// Supprime une partie en cours (administrateur). Une partie terminée compte dans le résultat
/// du match : elle ne se supprime pas.
#[utoipa::path(
    delete,
    path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}/games/{number}",
    tag = "match-games",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
        ("match_id" = Uuid, Path, description = "Identifiant du match"),
        ("number" = i32, Path, description = "Numéro de la partie, à partir de 1"),
    ),
    responses(
        (status = 204, description = "Partie supprimée"),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi, étape, match ou partie introuvable", body = ErrorResponse),
        (status = 409, description = "Étape non en cours, ou partie ou match terminé", body = ErrorResponse),
    ),
)]
#[delete("/tournaments/{id}/steps/{step_id}/matches/{match_id}/games/{number}")]
async fn delete_game(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid, Uuid, i32)>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, step_id, match_id, number) = path.into_inner();
    find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    let current = find_match(&state, &step, match_id).await?;
    require_ongoing(&step)?;
    require_open(&current)?;
    let game = find_game(&state, current.id, number).await?;
    require_game_ongoing(&game)?;
    if state
        .store
        .delete_match_game(game.id)
        .await
        .map_err(match_error)?
    {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::NotFound)
    }
}

/// Le match accepte encore des parties.
fn require_open(current: &Match) -> Result<(), ApiError> {
    if matches!(
        current.status,
        MatchStatus::Scheduled | MatchStatus::Ongoing
    ) {
        Ok(())
    } else {
        Err(ApiError::InvalidTransition)
    }
}

/// Une partie terminée ne change plus.
fn require_game_ongoing(game: &MatchGame) -> Result<(), ApiError> {
    if game.status == MatchStatus::Ongoing {
        Ok(())
    } else {
        Err(ApiError::InvalidTransition)
    }
}

async fn games_of(state: &AppState, match_id: Uuid) -> Result<Vec<MatchGame>, ApiError> {
    state
        .store
        .list_match_games(match_id)
        .await
        .map_err(ApiError::internal)
}

async fn find_game(state: &AppState, match_id: Uuid, number: i32) -> Result<MatchGame, ApiError> {
    games_of(state, match_id)
        .await?
        .into_iter()
        .find(|g| g.number == number)
        .ok_or(ApiError::NotFound)
}

fn game_participant(score: MatchScore) -> MatchGameParticipant {
    MatchGameParticipant {
        participant_id: score.participant_id,
        stats: score.stats,
        points: score.points,
        rank: score.rank,
        result: score.result,
    }
}

/// Ce qui interdit de saisir directement les résultats du match : il se joue en parties.
pub(crate) async fn games_problem(
    state: &AppState,
    current: &Match,
) -> Result<Option<String>, ApiError> {
    if current.best_of > 1 || !games_of(state, current.id).await?.is_empty() {
        return Ok(Some(
            "Ce match se joue en parties : saisissez et terminez chaque partie (`.../games`), le résultat du match en est déduit."
                .to_string(),
        ));
    }
    Ok(None)
}

/// Parties gagnées nécessaires pour remporter une série de `best_of` parties.
pub(crate) fn wins_needed(best_of: i32) -> usize {
    usize::try_from(best_of / 2 + 1).unwrap_or(1)
}

/// Parties gagnées (`win`) par participant, parmi les parties terminées.
fn wins(games: &[MatchGame]) -> HashMap<Uuid, usize> {
    let mut wins = HashMap::new();
    for game in games.iter().filter(|g| g.status == MatchStatus::Finished) {
        for participant in &game.participants {
            if participant.result == Some(MatchResult::Win) {
                *wins.entry(participant.participant_id).or_default() += 1;
            }
        }
    }
    wins
}

/// La série est décidée : un participant a la majorité des parties, ou toutes sont jouées.
pub(crate) fn is_decided(best_of: i32, games: &[MatchGame]) -> bool {
    let finished = games
        .iter()
        .filter(|g| g.status == MatchStatus::Finished)
        .count();
    finished >= usize::try_from(best_of).unwrap_or(1)
        || wins(games).values().any(|w| *w >= wins_needed(best_of))
}

/// Ce qui empêche de ramener la série à `best_of` parties, compte tenu des parties existantes.
pub(crate) fn series_problem(best_of: i32, games: &[MatchGame]) -> Option<String> {
    if games.len() > usize::try_from(best_of).unwrap_or(1) {
        return Some(format!(
            "Le match compte déjà {} parties, une série de {best_of} ne peut pas en avoir autant.",
            games.len()
        ));
    }
    if is_decided(best_of, games) {
        return Some(format!(
            "Les parties jouées décident déjà une série de {best_of} : terminez la partie en cours ou choisissez une série plus longue."
        ));
    }
    None
}

/// Résultat du match déduit des parties terminées : statistiques numériques cumulées (moyenne
/// pour un pourcentage), points cumulés et rang d'après les parties gagnées. Le résultat
/// (`win`, `loss`, `draw`) en est déduit à la clôture (voir `settle`).
pub(crate) fn aggregate(
    games: &[MatchGame],
    participants: &[Uuid],
    kinds: &HashMap<String, StatType>,
) -> Vec<MatchParticipant> {
    let finished: Vec<&MatchGame> = games
        .iter()
        .filter(|g| g.status == MatchStatus::Finished)
        .collect();
    let won = wins(games);
    let ranks: HashMap<Uuid, i32> = crate::ranking::rank(
        participants
            .iter()
            .map(|id| (*id, won.get(id).copied().unwrap_or(0) as f64))
            .collect(),
    )
    .into_iter()
    .map(|(rank, id, _)| (id, i32::try_from(rank).unwrap_or(i32::MAX)))
    .collect();
    participants
        .iter()
        .map(|id| {
            let mut sums: HashMap<&str, (f64, u32)> = HashMap::new();
            let mut points = 0.0;
            for game in &finished {
                let Some(member) = game.participants.iter().find(|p| p.participant_id == *id)
                else {
                    continue;
                };
                points += member.points;
                for (key, value) in numeric_values(&member.stats, kinds) {
                    let entry = sums.entry(key).or_default();
                    entry.0 += value;
                    entry.1 += 1;
                }
            }
            let stats: serde_json::Map<String, Value> = sums
                .into_iter()
                .map(|(key, (sum, count))| {
                    let value = if kinds.get(key) == Some(&StatType::Percent) {
                        sum / f64::from(count.max(1))
                    } else {
                        sum
                    };
                    (key.to_string(), json!(value))
                })
                .collect();
            MatchParticipant {
                match_id: Uuid::nil(),
                participant_id: *id,
                stats: Value::Object(stats),
                points,
                rank: ranks.get(id).copied(),
                result: None,
            }
        })
        .collect()
}

/// Valeurs numériques d'une statistique de participant (le `total` d'une équipe détaillée par
/// joueur), sans les choix.
fn numeric_values<'a>(stats: &'a Value, kinds: &HashMap<String, StatType>) -> Vec<(&'a str, f64)> {
    let Some(object) = stats.as_object() else {
        return Vec::new();
    };
    let object = match object.get("total").and_then(Value::as_object) {
        Some(total) if !kinds.contains_key("total") => total,
        _ => object,
    };
    object
        .iter()
        .filter(|(key, _)| kinds.contains_key(key.as_str()))
        .filter_map(|(key, value)| value.as_f64().map(|v| (key.as_str(), v)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(
        number: i32,
        status: MatchStatus,
        results: &[(Uuid, f64, MatchResult, Value)],
    ) -> MatchGame {
        MatchGame {
            id: Uuid::new_v4(),
            match_id: Uuid::nil(),
            number,
            status,
            attributes: json!({}),
            started_at: None,
            ended_at: None,
            created_at: String::new(),
            updated_at: String::new(),
            participants: results
                .iter()
                .map(|(id, points, result, stats)| MatchGameParticipant {
                    participant_id: *id,
                    stats: stats.clone(),
                    points: *points,
                    rank: None,
                    result: Some(*result),
                })
                .collect(),
        }
    }

    fn played(number: i32, winner: Uuid, loser: Uuid) -> MatchGame {
        game(
            number,
            MatchStatus::Finished,
            &[
                (
                    winner,
                    3.0,
                    MatchResult::Win,
                    json!({"kills": 10, "accuracy": 60}),
                ),
                (
                    loser,
                    1.0,
                    MatchResult::Loss,
                    json!({"kills": 4, "accuracy": 40}),
                ),
            ],
        )
    }

    fn kinds() -> HashMap<String, StatType> {
        HashMap::from([
            ("kills".to_string(), StatType::Flat),
            ("accuracy".to_string(), StatType::Percent),
        ])
    }

    #[test]
    fn a_majority_of_games_decides_the_series() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        assert_eq!(wins_needed(1), 1);
        assert_eq!(wins_needed(3), 2);
        assert_eq!(wins_needed(5), 3);
        // BO1 : une partie suffit.
        assert!(is_decided(1, &[played(1, a, b)]));
        assert!(!is_decided(1, &[]));
        // BO3 : 1-0 continue, 2-0 termine tôt, 1-1 continue.
        assert!(!is_decided(3, &[played(1, a, b)]));
        assert!(is_decided(3, &[played(1, a, b), played(2, a, b)]));
        assert!(!is_decided(3, &[played(1, a, b), played(2, b, a)]));
        assert!(is_decided(
            3,
            &[played(1, a, b), played(2, b, a), played(3, b, a)]
        ));
        // BO5 : 2-1 continue, 3-1 termine, une partie en cours ne compte pas.
        let ongoing = game(
            4,
            MatchStatus::Ongoing,
            &[(a, 0.0, MatchResult::Win, json!({}))],
        );
        assert!(!is_decided(
            5,
            &[played(1, a, b), played(2, a, b), played(3, b, a), ongoing]
        ));
        assert!(is_decided(
            5,
            &[
                played(1, a, b),
                played(2, a, b),
                played(3, b, a),
                played(4, a, b)
            ]
        ));
    }

    #[test]
    fn the_length_of_a_series_follows_its_games() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let games = [played(1, a, b), played(2, b, a)];
        assert!(series_problem(3, &games).is_none());
        assert!(series_problem(5, &games).is_none());
        // Deux parties dans une série de 1 : impossible ; 1-0 dans une série de 1 : décidée.
        assert!(series_problem(1, &games).is_some());
        assert!(series_problem(1, &[played(1, a, b)]).is_some());
        assert!(series_problem(3, &[]).is_none());
    }

    #[test]
    fn the_match_is_aggregated_from_its_finished_games() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let games = [played(1, a, b), played(2, a, b)];
        let totals = aggregate(&games, &[a, b], &kinds());
        let of = |id: Uuid| totals.iter().find(|t| t.participant_id == id).unwrap();
        assert_eq!(of(a).rank, Some(1));
        assert_eq!(of(b).rank, Some(2));
        assert_eq!(of(a).points, 6.0);
        assert_eq!(of(b).points, 2.0);
        // Valeurs brutes cumulées, pourcentages moyennés.
        assert_eq!(of(a).stats["kills"], 20.0);
        assert_eq!(of(a).stats["accuracy"], 60.0);
        let scores = settle(&totals).unwrap();
        let result = |id: Uuid| {
            scores
                .iter()
                .find(|s| s.participant_id == id)
                .unwrap()
                .result
        };
        assert_eq!(result(a), Some(MatchResult::Win));
        assert_eq!(result(b), Some(MatchResult::Loss));
    }

    #[test]
    fn an_even_series_is_a_draw_and_choices_are_not_summed() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let with_choice = game(
            1,
            MatchStatus::Finished,
            &[
                (
                    a,
                    1.0,
                    MatchResult::Win,
                    json!({"kills": 2, "character": "jett"}),
                ),
                (b, 0.0, MatchResult::Loss, json!({"kills": 1})),
            ],
        );
        let totals = aggregate(&[with_choice, played(2, b, a)], &[a, b], &kinds());
        assert!(totals[0].stats.get("character").is_none());
        let scores = settle(&totals).unwrap();
        assert!(scores.iter().all(|s| s.result == Some(MatchResult::Draw)));
    }

    #[test]
    fn a_team_total_is_what_counts() {
        let team = Uuid::new_v4();
        let detailed =
            json!({"total": {"kills": 12}, "players": {Uuid::new_v4().to_string(): {"kills": 5}}});
        let totals = aggregate(
            &[game(
                1,
                MatchStatus::Finished,
                &[(team, 0.0, MatchResult::Win, detailed)],
            )],
            &[team],
            &kinds(),
        );
        assert_eq!(totals[0].stats["kills"], 12.0);
    }
}
