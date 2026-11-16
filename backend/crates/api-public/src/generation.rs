//! Génération automatique des matchs d'une étape lancée : round-robin des poules, rondes suisses,
//! tableaux à élimination simple et double, avec byes, séries au meilleur de N et liens de
//! progression (vainqueur et perdant).
//!
//! `POST .../generate` crée les matchs de départ (une seule fois : jamais de régénération d'une
//! étape qui a déjà des matchs, créés à la main ou générés). `POST .../rounds` génère la ronde
//! suivante d'une étape suisse à partir du classement courant ; elle se génère aussi seule quand
//! la ronde en cours se termine. Chaque génération est transactionnelle et protégée contre les
//! appels concurrents.

use crate::auth::{AppState, Claims};
use crate::error::{ApiError, ErrorResponse};
use crate::matches::{MatchDetail, details_of};
use crate::standing::rank_group;
use crate::steps::{find_step, step_error};
use crate::store::{
    Bracket, GeneratedMatch, Generation, Match, MatchParticipant, MatchStatus, MatchType, Step,
    StepFormat, StepParticipant, StepStatus, Tournament,
};
use crate::tournaments::{active_participants, find_tournament};
use crate::users::require_admin;
use actix_web::{HttpResponse, post, web};
use domain::bracket::{
    BracketKind, PlannedMatch, double_elimination, round_robin, single_elimination,
};
use domain::swiss::{PairingError, SwissPlayer, pair_round};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use utoipa::ToSchema;
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

/// Routes de génération, avec leur documentation OpenAPI.
pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(generate_step).service(next_round);
}

/// Matchs créés par une génération.
#[derive(Serialize, ToSchema)]
struct GenerationResponse {
    matches: Vec<MatchDetail>,
}

/// Options de la ronde suivante.
#[derive(Deserialize, ToSchema, Default)]
struct NextRoundRequest {
    /// Accepte une revanche quand aucun appariement sans revanche n'existe ; refusé sinon.
    #[serde(default)]
    allow_rematches: bool,
}

/// Ce qu'une génération ne sait pas faire : `ffa` ne se joue qu'en poule.
pub(crate) fn support_problem(format: StepFormat, match_type: MatchType) -> Option<String> {
    if format != StepFormat::Pool && match_type == MatchType::Ffa {
        Some(format!(
            "Le format {} se joue en duel : ffa n'est possible qu'en poule.",
            match format {
                StepFormat::Swiss => "swiss",
                StepFormat::SingleElim => "single_elim",
                _ => "double_elim",
            }
        ))
    } else {
        None
    }
}

fn bye_points(step: &Step) -> f64 {
    step.rules.scoring.as_ref().map_or(0.0, |s| s.win)
}

fn best_of(step: &Step, round: i32) -> i32 {
    if step.match_type == MatchType::Duel {
        step.rules.best_of_for(round)
    } else {
        1
    }
}

fn number(value: usize) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
}

fn bracket_of(kind: BracketKind) -> Bracket {
    match kind {
        BracketKind::Winners => Bracket::Winners,
        BracketKind::Losers => Bracket::Losers,
        BracketKind::GrandFinal => Bracket::GrandFinal,
    }
}

/// Matchs de départ d'un groupe, `ids` étant ses participants par tête de série.
pub(crate) fn plan_group(
    step: &Step,
    group_id: Uuid,
    ids: &[Uuid],
    offset: usize,
) -> Result<Vec<GeneratedMatch>, ApiError> {
    if ids.len() < 2 {
        return Err(ApiError::Validation(vec![(
            "participants",
            "Un groupe a besoin d'au moins 2 participants pour générer ses matchs.".to_string(),
        )]));
    }
    let duel = |round: i32, number: i32, a: Uuid, b: Uuid| GeneratedMatch {
        group_id,
        round,
        number,
        bracket: None,
        best_of: best_of(step, round),
        participants: vec![(a, Some(1)), (b, Some(2))],
        next: None,
        loser_next: None,
        bye_points: None,
    };
    let mut out = Vec::new();
    match (step.format, step.match_type) {
        (StepFormat::Pool, MatchType::Duel) => {
            let rounds = round_robin(ids.len());
            for leg in 0..usize::try_from(step.matches_per_group).unwrap_or(1) {
                for (r, pairs) in rounds.iter().enumerate() {
                    let round = number(leg * rounds.len() + r + 1);
                    for (n, (a, b)) in pairs.iter().enumerate() {
                        // Une manche sur deux inverse les emplacements.
                        let (a, b) = if leg % 2 == 1 { (*b, *a) } else { (*a, *b) };
                        out.push(duel(round, number(n + 1), ids[a], ids[b]));
                    }
                }
            }
        }
        (StepFormat::Pool, MatchType::Ffa) => {
            for round in 1..=step.matches_per_group {
                out.push(GeneratedMatch {
                    group_id,
                    round,
                    number: 1,
                    bracket: None,
                    best_of: 1,
                    participants: ids.iter().map(|id| (*id, None)).collect(),
                    next: None,
                    loser_next: None,
                    bye_points: None,
                });
            }
        }
        (StepFormat::Swiss, MatchType::Duel) => {
            let players: Vec<SwissPlayer> = (0..ids.len())
                .map(|id| SwissPlayer {
                    id,
                    points: 0.0,
                    had_bye: false,
                })
                .collect();
            let round =
                pair_round(&players, &HashSet::new(), false).map_err(|_| pairing_error())?;
            out.extend(swiss_matches(step, group_id, ids, 1, &round));
        }
        (StepFormat::SingleElim | StepFormat::DoubleElim, MatchType::Duel) => {
            let plan: Vec<PlannedMatch> = if step.format == StepFormat::SingleElim {
                single_elimination(ids.len())
            } else {
                double_elimination(ids.len())
            };
            for planned in &plan {
                let participants = planned
                    .seeds
                    .iter()
                    .enumerate()
                    .filter_map(|(slot, seed)| seed.map(|s| (ids[s], Some(number(slot + 1)))))
                    .collect();
                out.push(GeneratedMatch {
                    group_id,
                    round: planned.round,
                    number: planned.number,
                    bracket: planned.bracket.map(bracket_of),
                    best_of: best_of(step, planned.round),
                    participants,
                    next: planned
                        .winner_to
                        .map(|(i, slot)| (offset + i, number(slot + 1))),
                    loser_next: planned
                        .loser_to
                        .map(|(i, slot)| (offset + i, number(slot + 1))),
                    bye_points: None,
                });
            }
        }
        _ => {
            return Err(ApiError::Validation(vec![(
                "format",
                support_problem(step.format, step.match_type)
                    .unwrap_or_else(|| "Combinaison non prise en charge.".to_string()),
            )]));
        }
    }
    Ok(out)
}

fn pairing_error() -> ApiError {
    ApiError::Validation(vec![(
        "pairing",
        "Aucun appariement sans revanche n'existe pour cette ronde ; relancez avec \
         `allow_rematches` pour accepter une revanche."
            .to_string(),
    )])
}

/// Matchs d'une ronde suisse : une paire par match, et un match exempt pour le bye.
fn swiss_matches(
    step: &Step,
    group_id: Uuid,
    ids: &[Uuid],
    round: i32,
    paired: &domain::swiss::SwissRound,
) -> Vec<GeneratedMatch> {
    let mut out: Vec<GeneratedMatch> = paired
        .pairs
        .iter()
        .enumerate()
        .map(|(n, (a, b))| GeneratedMatch {
            group_id,
            round,
            number: number(n + 1),
            bracket: None,
            best_of: best_of(step, round),
            participants: vec![(ids[*a], Some(1)), (ids[*b], Some(2))],
            next: None,
            loser_next: None,
            bye_points: None,
        })
        .collect();
    if let Some(bye) = paired.bye {
        out.push(GeneratedMatch {
            group_id,
            round,
            number: number(paired.pairs.len() + 1),
            bracket: None,
            best_of: 1,
            participants: vec![(ids[bye], Some(1))],
            next: None,
            loser_next: None,
            bye_points: Some(bye_points(step)),
        });
    }
    out
}

/// Participants d'un groupe par tête de série (les sans-tête de série à la fin, par identifiant).
fn seeded(members: &[StepParticipant], group_id: Uuid) -> Vec<Uuid> {
    let mut in_group: Vec<&StepParticipant> =
        members.iter().filter(|m| m.group_id == group_id).collect();
    in_group.sort_by_key(|m| (m.seed.unwrap_or(i32::MAX), m.participant_id));
    in_group.iter().map(|m| m.participant_id).collect()
}

/// Génère les matchs de départ de l'étape lancée (administrateur).
///
/// Selon le format : poule en duel → round-robin complet (`matches_per_group` aller-retour) ;
/// poule en ffa → `matches_per_group` manches réunissant tout le groupe ; suisse → première ronde
/// (les suivantes avec `POST .../rounds`) ; élimination simple ou double → tableau complet avec
/// byes pour les meilleures têtes de série, liens vainqueur/perdant et manche de « reset » de la
/// grande finale. Les participants sont placés d'après leurs têtes de série. Chaque match reçoit
/// la série (`best_of`) configurée pour sa ronde. Refusé s'il existe déjà des matchs.
#[utoipa::path(
    post,
    path = "/tournaments/{id}/steps/{step_id}/generate",
    tag = "steps",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
    ),
    responses(
        (status = 201, description = "Matchs générés", body = GenerationResponse),
        (status = 400, description = "Format ou nombre de participants non pris en charge", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi ou étape introuvable", body = ErrorResponse),
        (status = 409, description = "Étape non en cours ou matchs déjà présents", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/steps/{step_id}/generate")]
async fn generate_step(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, step_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    if step.status != StepStatus::Ongoing {
        return Err(ApiError::InvalidTransition);
    }
    let existing = state
        .store
        .list_matches(step.id, None, None)
        .await
        .map_err(ApiError::internal)?;
    if !existing.is_empty() {
        return Err(ApiError::InvalidTransition);
    }
    let groups = state
        .store
        .list_step_groups(step.id)
        .await
        .map_err(ApiError::internal)?;
    let members = state
        .store
        .list_step_participants(step.id)
        .await
        .map_err(ApiError::internal)?;
    let mut matches = Vec::new();
    for group in &groups {
        let ids = seeded(&members, group.id);
        let offset = matches.len();
        matches.extend(plan_group(&step, group.id, &ids, offset)?);
    }
    let bye_totals = bye_totals(&matches, &HashMap::new());
    let created = state
        .store
        .generate_matches(Generation {
            step_id: step.id,
            game_id: tournament.game_id,
            matches,
            step_points: bye_totals,
            initial: true,
        })
        .await
        .map_err(step_error)?;
    let details = details_of(&state, &step, created).await?;
    Ok(HttpResponse::Created().json(GenerationResponse { matches: details }))
}

/// Total de points des participants exempts : leurs points actuels plus ceux du bye.
fn bye_totals(matches: &[GeneratedMatch], current: &HashMap<Uuid, f64>) -> Vec<(Uuid, f64)> {
    let mut totals: HashMap<Uuid, f64> = HashMap::new();
    for planned in matches {
        if let Some(points) = planned.bye_points {
            for (id, _) in &planned.participants {
                let base = totals
                    .get(id)
                    .copied()
                    .unwrap_or_else(|| current.get(id).copied().unwrap_or(0.0));
                totals.insert(*id, base + points);
            }
        }
    }
    totals.into_iter().collect()
}

/// Génère la ronde suivante d'une étape suisse (administrateur) d'après le classement courant :
/// les participants se rencontrent dans leur groupe de points, sans revanche tant que c'est
/// possible ; un nombre impair donne un bye (victoire) au dernier du classement qui n'en a pas
/// encore eu. La ronde en cours doit être terminée et `matches_per_group` rondes ne peuvent pas
/// être dépassées.
#[utoipa::path(
    post,
    path = "/tournaments/{id}/steps/{step_id}/rounds",
    tag = "steps",
    security(("bearer" = [])),
    params(
        ("id" = Uuid, Path, description = "Identifiant du tournoi"),
        ("step_id" = Uuid, Path, description = "Identifiant de l'étape"),
    ),
    request_body(content = NextRoundRequest, description = "Facultatif"),
    responses(
        (status = 201, description = "Ronde générée", body = GenerationResponse),
        (status = 400, description = "Format non suisse ou appariement impossible sans revanche", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Réservé aux administrateurs", body = ErrorResponse),
        (status = 404, description = "Tournoi ou étape introuvable", body = ErrorResponse),
        (status = 409, description = "Étape non en cours, ronde en cours non terminée ou rondes épuisées", body = ErrorResponse),
    ),
)]
#[post("/tournaments/{id}/steps/{step_id}/rounds")]
async fn next_round(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid)>,
    body: Option<web::Json<NextRoundRequest>>,
) -> Result<HttpResponse, ApiError> {
    require_admin(&state, &claims).await?;
    let (tournament_id, step_id) = path.into_inner();
    let tournament = find_tournament(&state, tournament_id).await?;
    let step = find_step(&state, tournament_id, step_id).await?;
    let allow = body.is_some_and(|b| b.allow_rematches);
    let created = generate_next_round(&state, &tournament, &step, allow).await?;
    let details = details_of(&state, &step, created).await?;
    Ok(HttpResponse::Created().json(GenerationResponse { matches: details }))
}

/// Génère la ronde suivante de l'étape suisse ; sert la route et l'enchaînement automatique.
pub(crate) async fn generate_next_round(
    state: &AppState,
    tournament: &Tournament,
    step: &Step,
    allow_rematches: bool,
) -> Result<Vec<Match>, ApiError> {
    if step.format != StepFormat::Swiss {
        return Err(ApiError::Validation(vec![(
            "format",
            "Seule une étape suisse se génère ronde par ronde.".to_string(),
        )]));
    }
    if step.status != StepStatus::Ongoing {
        return Err(ApiError::InvalidTransition);
    }
    let matches = state
        .store
        .list_matches(step.id, None, None)
        .await
        .map_err(ApiError::internal)?;
    let last = matches.iter().filter_map(|m| m.round).max().unwrap_or(0);
    if last == 0
        || last >= step.matches_per_group
        || matches
            .iter()
            .any(|m| matches!(m.status, MatchStatus::Scheduled | MatchStatus::Ongoing))
    {
        return Err(ApiError::InvalidTransition);
    }
    let groups = state
        .store
        .list_step_groups(step.id)
        .await
        .map_err(ApiError::internal)?;
    let members = state
        .store
        .list_step_participants(step.id)
        .await
        .map_err(ApiError::internal)?;
    let all_members = state
        .store
        .list_step_match_participants(step.id)
        .await
        .map_err(ApiError::internal)?;
    let registered: HashMap<Uuid, String> = active_participants(state, tournament.id)
        .await?
        .into_iter()
        .map(|p| (p.id, p.registered_at))
        .collect();
    let by_match = group_by_match(&all_members);

    let mut planned = Vec::new();
    let mut current_points: HashMap<Uuid, f64> = HashMap::new();
    for group in &groups {
        let in_group: Vec<&StepParticipant> =
            members.iter().filter(|m| m.group_id == group.id).collect();
        let group_matches: Vec<&Match> = matches
            .iter()
            .filter(|m| m.group_id == Some(group.id))
            .collect();
        for member in &in_group {
            current_points.insert(member.participant_id, member.points);
        }
        // Classement courant : points puis départages de l'étape.
        let standing = rank_group(step, &in_group, &group_matches, &by_match, &registered);
        let ids: Vec<Uuid> = standing.iter().map(|(id, _)| *id).collect();
        let index: HashMap<Uuid, usize> = ids.iter().enumerate().map(|(i, id)| (*id, i)).collect();
        let mut played: HashSet<(usize, usize)> = HashSet::new();
        let mut had_bye: HashSet<usize> = HashSet::new();
        for m in &group_matches {
            let who: Vec<usize> = by_match
                .get(&m.id)
                .into_iter()
                .flatten()
                .filter_map(|p| index.get(&p.participant_id).copied())
                .collect();
            match who[..] {
                [a, b] => {
                    played.insert((a.min(b), a.max(b)));
                }
                [a] => {
                    had_bye.insert(a);
                }
                _ => {}
            }
        }
        let players: Vec<SwissPlayer> = ids
            .iter()
            .enumerate()
            .map(|(i, id)| SwissPlayer {
                id: i,
                points: current_points.get(id).copied().unwrap_or(0.0),
                had_bye: had_bye.contains(&i),
            })
            .collect();
        let round = pair_round(&players, &played, allow_rematches)
            .map_err(|PairingError::Impossible| pairing_error())?;
        planned.extend(swiss_matches(step, group.id, &ids, last + 1, &round));
    }
    let totals = bye_totals(&planned, &current_points);
    state
        .store
        .generate_matches(Generation {
            step_id: step.id,
            game_id: tournament.game_id,
            matches: planned,
            step_points: totals,
            initial: false,
        })
        .await
        .map_err(step_error)
}

/// Participants des matchs de l'étape, regroupés par match.
pub(crate) fn group_by_match(
    members: &[MatchParticipant],
) -> HashMap<Uuid, Vec<&MatchParticipant>> {
    let mut grouped: HashMap<Uuid, Vec<&MatchParticipant>> = HashMap::new();
    for member in members {
        grouped.entry(member.match_id).or_default().push(member);
    }
    grouped
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::StepRules;

    fn step(format: StepFormat, match_type: MatchType, per_group: i32) -> Step {
        Step {
            id: Uuid::nil(),
            tournament_id: Uuid::nil(),
            position: 1,
            format,
            match_type,
            group_count: 1,
            group_size: 8,
            matches_per_group: per_group,
            advance_per_group: 1,
            tiebreak: serde_json::json!([]),
            rules: StepRules::default(),
            status: StepStatus::Ongoing,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn ids(count: u128) -> Vec<Uuid> {
        (1..=count).map(Uuid::from_u128).collect()
    }

    #[test]
    fn a_duel_pool_is_a_full_round_robin() {
        let plan = plan_group(
            &step(StepFormat::Pool, MatchType::Duel, 1),
            Uuid::nil(),
            &ids(5),
            0,
        )
        .unwrap();
        assert_eq!(plan.len(), 10);
        let pairs: HashSet<(Uuid, Uuid)> = plan
            .iter()
            .map(|m| {
                let (a, b) = (m.participants[0].0, m.participants[1].0);
                (a.min(b), a.max(b))
            })
            .collect();
        assert_eq!(pairs.len(), 10);
    }

    #[test]
    fn two_legs_play_every_pair_twice() {
        let plan = plan_group(
            &step(StepFormat::Pool, MatchType::Duel, 2),
            Uuid::nil(),
            &ids(4),
            0,
        )
        .unwrap();
        assert_eq!(plan.len(), 12);
        assert_eq!(plan.iter().map(|m| m.round).max(), Some(6));
    }

    #[test]
    fn an_ffa_pool_plays_one_match_per_round_with_everyone() {
        let plan = plan_group(
            &step(StepFormat::Pool, MatchType::Ffa, 3),
            Uuid::nil(),
            &ids(8),
            0,
        )
        .unwrap();
        assert_eq!(plan.len(), 3);
        assert!(plan.iter().all(|m| m.participants.len() == 8));
    }

    #[test]
    fn swiss_starts_with_one_round_and_a_bye_for_an_odd_field() {
        let plan = plan_group(
            &step(StepFormat::Swiss, MatchType::Duel, 3),
            Uuid::nil(),
            &ids(5),
            0,
        )
        .unwrap();
        assert_eq!(plan.len(), 3);
        assert_eq!(plan.iter().filter(|m| m.bye_points.is_some()).count(), 1);
        assert!(plan.iter().all(|m| m.round == 1));
    }

    #[test]
    fn single_elimination_links_winners_and_places_seeds() {
        let ids = ids(6);
        let plan = plan_group(
            &step(StepFormat::SingleElim, MatchType::Duel, 1),
            Uuid::nil(),
            &ids,
            0,
        )
        .unwrap();
        assert_eq!(plan.len(), 5);
        // Les têtes de série 1 et 2 passent le premier tour : elles sont placées au tour 2.
        let placed_in_round_two: Vec<Uuid> = plan
            .iter()
            .filter(|m| m.round == 2)
            .flat_map(|m| m.participants.iter().map(|(id, _)| *id))
            .collect();
        assert!(placed_in_round_two.contains(&ids[0]));
        assert!(placed_in_round_two.contains(&ids[1]));
        assert_eq!(plan.iter().filter(|m| m.next.is_none()).count(), 1);
    }

    #[test]
    fn double_elimination_links_losers_and_the_reset() {
        let plan = plan_group(
            &step(StepFormat::DoubleElim, MatchType::Duel, 1),
            Uuid::nil(),
            &ids(8),
            0,
        )
        .unwrap();
        assert_eq!(plan.len(), 15);
        assert_eq!(
            plan.iter()
                .filter(|m| m.bracket == Some(Bracket::GrandFinal))
                .count(),
            2
        );
        assert!(
            plan.iter()
                .filter(|m| m.bracket == Some(Bracket::Winners))
                .all(|m| m.loser_next.is_some())
        );
    }

    #[test]
    fn series_follow_the_round_configuration() {
        let mut elimination = step(StepFormat::SingleElim, MatchType::Duel, 1);
        elimination.rules.best_of = 3;
        elimination
            .rules
            .best_of_by_round
            .insert("3".to_string(), 5);
        let plan = plan_group(&elimination, Uuid::nil(), &ids(8), 0).unwrap();
        assert!(plan.iter().filter(|m| m.round < 3).all(|m| m.best_of == 3));
        assert!(plan.iter().filter(|m| m.round == 3).all(|m| m.best_of == 5));
    }

    #[test]
    fn unsupported_combinations_are_rejected() {
        assert!(support_problem(StepFormat::Swiss, MatchType::Ffa).is_some());
        assert!(support_problem(StepFormat::DoubleElim, MatchType::Ffa).is_some());
        assert!(support_problem(StepFormat::Pool, MatchType::Ffa).is_none());
        assert!(
            plan_group(
                &step(StepFormat::SingleElim, MatchType::Ffa, 1),
                Uuid::nil(),
                &ids(4),
                0
            )
            .is_err()
        );
        assert!(
            plan_group(
                &step(StepFormat::Pool, MatchType::Duel, 1),
                Uuid::nil(),
                &ids(1),
                0
            )
            .is_err()
        );
    }
}
