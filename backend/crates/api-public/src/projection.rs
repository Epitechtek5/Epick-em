//! Report d'un tournoi importé (start.gg…) dans le modèle local, à chaque synchronisation.
//!
//! Les inscrits de la source n'ont pas de compte : ils deviennent des inscrits « importés »,
//! visibles avec leur nom chez la source mais liés à aucun utilisateur. Chaque phase devient une
//! étape, chaque groupe (poule, tableau) un groupe, chaque set un match avec ses résultats. Le
//! tournoi reste en lecture seule ([`crate::external::protect_external`]) : seule la
//! synchronisation l'écrit.

use crate::store::{
    AuthStore, Bracket, MatchResult, MatchStatus, MatchType, ParticipantStatus, ProjectedEntry,
    ProjectedGroup, ProjectedMatch, ProjectedMember, ProjectedParticipant, ProjectedStep,
    Projection, StepDefinition, StepFormat, StepParticipantStatus, StepStatus, TournamentStatus,
    unix_to_rfc3339,
};
use async_trait::async_trait;
use connectors::model::{
    BracketFormat, CompetitionState, ExternalEvent, ExternalMatch, ExternalPhase,
    ExternalTournament, MatchState,
};
use connectors::sync::{ProjectionEntry, Projector};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use uuid::Uuid;

/// Longueur maximale d'un nom affiché (colonne `display_name`).
const NAME_MAX: usize = 255;

/// [`Projector`] qui écrit dans le store de l'API.
pub struct StoreProjector {
    store: Arc<dyn AuthStore>,
}

impl StoreProjector {
    pub fn new(store: Arc<dyn AuthStore>) -> Self {
        StoreProjector { store }
    }
}

#[async_trait]
impl Projector for StoreProjector {
    async fn prepare(
        &self,
        tournament_id: Uuid,
        snapshot: &ExternalTournament,
    ) -> Result<Vec<ProjectionEntry>, String> {
        match self
            .store
            .prepare_external(tournament_id, projection(snapshot))
            .await
        {
            Ok(Some(entries)) => Ok(entries),
            Ok(None) => Err(format!("tournoi local {tournament_id} introuvable")),
            Err(err) => Err(err.to_string()),
        }
    }
}

/// Identifiant local d'un inscrit de la source : les inscrits sont propres à une épreuve.
fn entrant_key(event: &ExternalEvent, entrant_id: &str) -> String {
    format!("{}:{entrant_id}", event.reference.external_id)
}

/// Traduit un instantané de la source en modèle local.
pub fn projection(snapshot: &ExternalTournament) -> Projection {
    let status = match snapshot.state {
        CompetitionState::Created => TournamentStatus::Draft,
        CompetitionState::Active => TournamentStatus::Ongoing,
        CompetitionState::Completed => TournamentStatus::Finished,
    };
    let mut participants = Vec::new();
    let mut steps = Vec::new();
    for event in &snapshot.events {
        let mut entrants: Vec<_> = event.entrants.iter().collect();
        entrants.sort_by_key(|e| (e.seed.unwrap_or(u32::MAX), e.external_id.clone()));
        participants.extend(entrants.into_iter().map(|e| ProjectedParticipant {
            external_id: entrant_key(event, &e.external_id),
            display_name: e.name.chars().take(NAME_MAX).collect(),
            status: ParticipantStatus::Registered,
        }));
        let mut phases: Vec<&ExternalPhase> = event
            .phases
            .iter()
            .filter(|p| !p.groups.is_empty())
            .collect();
        phases.sort_by_key(|p| p.order.unwrap_or(u32::MAX));
        for (index, phase) in phases.iter().enumerate() {
            let later: HashSet<&str> = phases[index + 1..]
                .iter()
                .flat_map(|p| phase_members(event, p))
                .collect();
            let position = i32::try_from(steps.len() + 1).unwrap_or(i32::MAX);
            steps.push(step(
                event,
                phase,
                position,
                &later,
                index + 1 == phases.len(),
            ));
        }
    }
    Projection {
        status,
        participants,
        steps,
    }
}

/// Matchs d'un groupe de la source.
fn group_matches<'a>(event: &'a ExternalEvent, group_id: &str) -> Vec<&'a ExternalMatch> {
    event
        .matches
        .iter()
        .filter(|m| m.group_id.as_deref() == Some(group_id))
        .collect()
}

/// Inscrits d'un groupe, dans l'ordre où ils apparaissent dans ses matchs : la source ne
/// publie pas la composition des groupes, seulement leurs sets.
fn members<'a>(matches: &[&'a ExternalMatch]) -> Vec<&'a str> {
    let mut seen = HashSet::new();
    matches
        .iter()
        .flat_map(|m| m.slots.iter())
        .filter_map(|slot| slot.entrant_id.as_deref())
        .filter(|id| seen.insert(*id))
        .collect()
}

fn phase_members<'a>(event: &'a ExternalEvent, phase: &'a ExternalPhase) -> Vec<&'a str> {
    phase
        .groups
        .iter()
        .flat_map(|g| members(&group_matches(event, &g.external_id)))
        .collect()
}

fn step_status(state: CompetitionState) -> StepStatus {
    match state {
        CompetitionState::Created => StepStatus::Pending,
        CompetitionState::Active => StepStatus::Ongoing,
        CompetitionState::Completed => StepStatus::Finished,
    }
}

fn step(
    event: &ExternalEvent,
    phase: &ExternalPhase,
    position: i32,
    later: &HashSet<&str>,
    last: bool,
) -> ProjectedStep {
    let format = match (phase.groups.len(), phase.format) {
        // Plusieurs groupes : seules les poules le permettent localement.
        (n, _) if n > 1 => StepFormat::Pool,
        (_, Some(BracketFormat::SingleElimination)) => StepFormat::SingleElim,
        (_, Some(BracketFormat::DoubleElimination)) => StepFormat::DoubleElim,
        (_, Some(BracketFormat::Swiss)) => StepFormat::Swiss,
        _ => StepFormat::Pool,
    };
    let losses_out = match format {
        StepFormat::SingleElim => Some(1),
        StepFormat::DoubleElim => Some(2),
        _ => None,
    };
    let standings: HashMap<&str, u32> = event
        .standings
        .iter()
        .map(|s| (s.entrant_id.as_str(), s.placement))
        .collect();
    let mut ffa = false;
    let mut group_size = 1;
    let mut matches_per_group = 1;
    let mut advance = 0;
    let groups: Vec<ProjectedGroup> = phase
        .groups
        .iter()
        .map(|group| {
            let matches = group_matches(event, &group.external_id);
            ffa |= matches.iter().any(|m| m.slots.len() > 2);
            let ids = members(&matches);
            group_size = group_size.max(ids.len());
            matches_per_group = matches_per_group.max(matches.len());
            advance = advance.max(ids.iter().filter(|id| later.contains(*id)).count());
            let finished = group.state == CompetitionState::Completed
                || phase.state == CompetitionState::Completed;
            let members = ids
                .iter()
                .map(|id| {
                    let decided = matches.iter().filter(|m| m.state == MatchState::Completed);
                    let wins = decided
                        .clone()
                        .filter(|m| m.winner_entrant_id.as_deref() == Some(*id))
                        .count();
                    let losses = decided
                        .filter(|m| m.winner_entrant_id.as_deref().is_some_and(|w| w != *id))
                        .filter(|m| m.slots.iter().any(|s| s.entrant_id.as_deref() == Some(*id)))
                        .count();
                    let placement = standings.get(id).copied();
                    let status = if later.contains(id) || (last && finished && placement == Some(1))
                    {
                        StepParticipantStatus::Qualified
                    } else if finished || losses_out.is_some_and(|out| losses >= out) {
                        StepParticipantStatus::Eliminated
                    } else {
                        StepParticipantStatus::In
                    };
                    ProjectedMember {
                        participant: entrant_key(event, id),
                        points: wins as f64,
                        final_rank: if last {
                            placement.and_then(|p| i32::try_from(p).ok())
                        } else {
                            None
                        },
                        status,
                    }
                })
                .collect();
            ProjectedGroup {
                external_id: group.external_id.clone(),
                members,
                matches: matches
                    .iter()
                    .map(|m| projected_match(event, m, format))
                    .collect(),
            }
        })
        .collect();
    let to_i32 = |n: usize| i32::try_from(n).unwrap_or(i32::MAX);
    ProjectedStep {
        external_id: format!("{}:{}", event.reference.external_id, phase.external_id),
        definition: StepDefinition {
            position,
            format,
            match_type: if ffa { MatchType::Ffa } else { MatchType::Duel },
            group_count: to_i32(phase.groups.len()),
            group_size: to_i32(group_size),
            matches_per_group: to_i32(matches_per_group),
            advance_per_group: to_i32(advance.clamp(1, group_size)),
            tiebreak: json!([]),
        },
        status: step_status(phase.state),
        groups,
    }
}

fn projected_match(event: &ExternalEvent, m: &ExternalMatch, format: StepFormat) -> ProjectedMatch {
    let status = match m.state {
        MatchState::Pending => MatchStatus::Scheduled,
        MatchState::InProgress => MatchStatus::Ongoing,
        MatchState::Completed => MatchStatus::Finished,
    };
    let grand_final = m
        .round_label
        .as_deref()
        .is_some_and(|l| l.to_lowercase().contains("grand final"));
    let side = match m.round {
        _ if grand_final => Bracket::GrandFinal,
        Some(r) if r < 0 => Bracket::Losers,
        _ => Bracket::Winners,
    };
    let bracket = (format == StepFormat::DoubleElim).then_some(side);
    // Un horaire incohérent (fin avant début) ne garde que la fin.
    let started_at = m
        .started_at
        .filter(|s| m.completed_at.is_none_or(|e| e >= *s))
        .map(|s| unix_to_rfc3339(s, 0));
    let entries = m
        .slots
        .iter()
        .filter_map(|slot| {
            let id = slot.entrant_id.as_deref()?;
            let result =
                (m.state == MatchState::Completed).then(|| match m.winner_entrant_id.as_deref() {
                    Some(w) if w == id => MatchResult::Win,
                    Some(_) => MatchResult::Loss,
                    None => MatchResult::Draw,
                });
            Some(ProjectedEntry {
                participant: entrant_key(event, id),
                stats: match slot.score {
                    Some(score) => json!({ "score": score }),
                    None => json!({}),
                },
                points: if result == Some(MatchResult::Win) {
                    1.0
                } else {
                    0.0
                },
                rank: match result {
                    Some(MatchResult::Win) => Some(1),
                    Some(MatchResult::Loss) if m.slots.len() == 2 => Some(2),
                    _ => None,
                },
                result,
            })
        })
        .collect();
    ProjectedMatch {
        external_id: m.external_id.clone(),
        round: m.round.map(i32::abs).filter(|r| *r > 0),
        bracket,
        status,
        started_at,
        ended_at: m.completed_at.map(|e| unix_to_rfc3339(e, 0)),
        entries,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use connectors::model::{
        ExternalEntrant, ExternalEventRef, ExternalGroup, ExternalSlot, ExternalStanding,
        ExternalTournamentRef,
    };

    fn group(id: &str, format: BracketFormat, state: CompetitionState) -> ExternalGroup {
        ExternalGroup {
            external_id: id.into(),
            label: None,
            format: Some(format),
            state,
            url: None,
        }
    }

    fn set(
        id: &str,
        group: &str,
        round: i32,
        a: &str,
        b: &str,
        winner: Option<&str>,
    ) -> ExternalMatch {
        ExternalMatch {
            external_id: id.into(),
            phase_id: None,
            group_id: Some(group.into()),
            round: Some(round),
            round_label: None,
            state: if winner.is_some() {
                MatchState::Completed
            } else {
                MatchState::Pending
            },
            slots: [a, b]
                .iter()
                .map(|e| ExternalSlot {
                    entrant_id: Some((*e).into()),
                    score: None,
                })
                .collect(),
            winner_entrant_id: winner.map(Into::into),
            forfeit: false,
            games: Vec::new(),
            started_at: Some(200),
            completed_at: winner.map(|_| 100),
            updated_at: None,
            url: None,
        }
    }

    /// Deux poules (A, B ; C, D) dont sortent A et C, puis une double élimination en cours.
    fn snapshot() -> ExternalTournament {
        let done = CompetitionState::Completed;
        let live = CompetitionState::Active;
        let mut grand_final = set("gf", "top", 3, "a", "c", None);
        grand_final.round_label = Some("Grand Final".into());
        ExternalTournament {
            reference: ExternalTournamentRef {
                provider: "fake".into(),
                external_id: "1".into(),
                slug: None,
                name: "Cup".into(),
                url: None,
                starts_at: None,
                ends_at: None,
            },
            state: live,
            events: vec![ExternalEvent {
                reference: ExternalEventRef {
                    external_id: "ev".into(),
                    name: "Main".into(),
                    game: None,
                    url: None,
                    starts_at: None,
                    state: live,
                    entrant_count: Some(4),
                },
                phases: vec![
                    ExternalPhase {
                        external_id: "top".into(),
                        name: "Top 2".into(),
                        order: Some(2),
                        format: Some(BracketFormat::DoubleElimination),
                        state: live,
                        groups: vec![group("top", BracketFormat::DoubleElimination, live)],
                    },
                    ExternalPhase {
                        external_id: "pools".into(),
                        name: "Poules".into(),
                        order: Some(1),
                        format: Some(BracketFormat::RoundRobin),
                        state: done,
                        groups: vec![
                            group("p1", BracketFormat::RoundRobin, done),
                            group("p2", BracketFormat::RoundRobin, done),
                        ],
                    },
                ],
                entrants: ["a", "b", "c", "d"]
                    .iter()
                    .enumerate()
                    .map(|(i, id)| ExternalEntrant {
                        external_id: (*id).into(),
                        name: id.to_uppercase(),
                        seed: Some(u32::try_from(i + 1).unwrap()),
                        players: Vec::new(),
                    })
                    .collect(),
                matches: vec![
                    set("s1", "p1", 1, "a", "b", Some("a")),
                    set("s2", "p2", 1, "c", "d", Some("c")),
                    set("w1", "top", 1, "a", "c", Some("a")),
                    set("l1", "top", -1, "c", "a", None),
                    grand_final,
                ],
                standings: vec![ExternalStanding {
                    entrant_id: "a".into(),
                    placement: 1,
                }],
            }],
        }
    }

    #[test]
    fn phases_become_ordered_steps_with_imported_entrants() {
        let p = projection(&snapshot());
        assert_eq!(p.status, TournamentStatus::Ongoing);
        let names: Vec<&str> = p
            .participants
            .iter()
            .map(|e| e.display_name.as_str())
            .collect();
        assert_eq!(names, ["A", "B", "C", "D"]);
        assert_eq!(p.participants[0].external_id, "ev:a");

        let pools = &p.steps[0];
        assert_eq!(pools.external_id, "ev:pools");
        assert_eq!(pools.definition.position, 1);
        assert_eq!(pools.definition.format, StepFormat::Pool);
        assert_eq!(pools.definition.group_count, 2);
        assert_eq!(pools.definition.group_size, 2);
        assert_eq!(pools.definition.advance_per_group, 1);
        assert_eq!(pools.status, StepStatus::Finished);
        let p1 = &pools.groups[0];
        let status = |g: &ProjectedGroup, who: &str| {
            g.members
                .iter()
                .find(|m| m.participant == format!("ev:{who}"))
                .map(|m| m.status)
        };
        // A passe au tableau final, B est éliminé avec la poule terminée.
        assert_eq!(status(p1, "a"), Some(StepParticipantStatus::Qualified));
        assert_eq!(status(p1, "b"), Some(StepParticipantStatus::Eliminated));
        assert_eq!(p1.members[0].points, 1.0);

        let top = &p.steps[1];
        assert_eq!(top.definition.position, 2);
        assert_eq!(top.definition.format, StepFormat::DoubleElim);
        let brackets: Vec<_> = top.groups[0].matches.iter().map(|m| m.bracket).collect();
        assert_eq!(
            brackets,
            [
                Some(Bracket::Winners),
                Some(Bracket::Losers),
                Some(Bracket::GrandFinal)
            ]
        );
        assert_eq!(top.groups[0].matches[1].round, Some(1));
        // Une défaite en double élimination ne sort pas encore.
        assert_eq!(status(&top.groups[0], "c"), Some(StepParticipantStatus::In));
    }

    #[test]
    fn results_follow_the_source_set() {
        let p = projection(&snapshot());
        let won = &p.steps[0].groups[0].matches[0];
        assert_eq!(won.status, MatchStatus::Finished);
        // Début postérieur à la fin chez la source : seul l'horaire de fin est gardé.
        assert_eq!(won.started_at, None);
        assert!(won.ended_at.is_some());
        let result = |who: &str| {
            won.entries
                .iter()
                .find(|e| e.participant == format!("ev:{who}"))
                .map(|e| (e.result, e.rank, e.points))
        };
        assert_eq!(result("a"), Some((Some(MatchResult::Win), Some(1), 1.0)));
        assert_eq!(result("b"), Some((Some(MatchResult::Loss), Some(2), 0.0)));
        let pending = &p.steps[1].groups[0].matches[1];
        assert_eq!(pending.status, MatchStatus::Scheduled);
        assert!(pending.entries.iter().all(|e| e.result.is_none()));
    }
}
