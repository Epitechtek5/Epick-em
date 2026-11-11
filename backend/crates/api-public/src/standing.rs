//! Classement d'un groupe d'étape : points, puis critères de départage de l'étape
//! (`tiebreak` : `head_to_head`, `game_differential`, `buchholz`), puis ordre d'inscription.
//!
//! Le même calcul sert au classement en direct, au classement définitif de la clôture et à la
//! qualification, pour qu'ils ne divergent jamais. En élimination, l'ordre vient du tableau : le
//! vainqueur de la dernière manche, son adversaire, puis le nombre de victoires.

use crate::store::StepParticipant;
use crate::store::{Bracket, Match, MatchParticipant, MatchResult, MatchStatus, Step, StepFormat};
use domain::standings::{Entry, FinishedMatch, Tiebreak, rank};
use std::collections::HashMap;
use uuid::Uuid;

/// Critères de départage reconnus, dans l'ordre configuré ; les autres clés sont ignorées.
pub(crate) fn criteria(step: &Step) -> Vec<Tiebreak> {
    step.tiebreak
        .as_array()
        .map(|keys| {
            keys.iter()
                .filter_map(|k| k.as_str().and_then(Tiebreak::parse))
                .collect()
        })
        .unwrap_or_default()
}

fn bracket_rank(bracket: Option<Bracket>) -> u8 {
    match bracket {
        None | Some(Bracket::Winners) => 0,
        Some(Bracket::Losers) => 1,
        Some(Bracket::GrandFinal) => 2,
    }
}

/// Participants du groupe dans l'ordre du classement ; `true` quand le participant partage le
/// rang du précédent. `registered` donne l'horodatage d'inscription (dernier départage).
pub(crate) fn rank_group(
    step: &Step,
    members: &[&StepParticipant],
    matches: &[&Match],
    by_match: &HashMap<Uuid, Vec<&MatchParticipant>>,
    registered: &HashMap<Uuid, String>,
) -> Vec<(Uuid, bool)> {
    let mut order: Vec<&StepParticipant> = members.to_vec();
    order.sort_by(|a, b| {
        registered
            .get(&a.participant_id)
            .cmp(&registered.get(&b.participant_id))
            .then_with(|| a.participant_id.cmp(&b.participant_id))
    });
    let index: HashMap<Uuid, usize> = order
        .iter()
        .enumerate()
        .map(|(i, m)| (m.participant_id, i))
        .collect();
    let players: Vec<usize> = (0..order.len()).collect();

    let finished: Vec<&&Match> = matches
        .iter()
        .filter(|m| m.status == MatchStatus::Finished)
        .collect();
    let history: Vec<FinishedMatch> = finished
        .iter()
        .map(|m| {
            by_match
                .get(&m.id)
                .map(|entries| {
                    entries
                        .iter()
                        .filter_map(|p| {
                            Some(Entry {
                                player: *index.get(&p.participant_id)?,
                                rank: p.rank,
                                games_won: p.games_won,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default()
        })
        .collect();

    let mut points: HashMap<usize, f64> = order
        .iter()
        .enumerate()
        .map(|(i, m)| (i, m.points))
        .collect();
    if matches!(step.format, StepFormat::SingleElim | StepFormat::DoubleElim) {
        points = elimination_keys(&finished, by_match, &index);
        for i in 0..order.len() {
            points.entry(i).or_insert(0.0);
        }
    }
    rank(&players, &points, &history, &criteria(step))
        .into_iter()
        .map(|r| (order[r.player].participant_id, r.tied))
        .collect()
}

/// Valeur d'ordre en élimination : le vainqueur de la dernière manche, puis son adversaire, puis
/// le nombre de victoires.
fn elimination_keys(
    finished: &[&&Match],
    by_match: &HashMap<Uuid, Vec<&MatchParticipant>>,
    index: &HashMap<Uuid, usize>,
) -> HashMap<usize, f64> {
    let mut keys: HashMap<usize, f64> = HashMap::new();
    for m in finished {
        for p in by_match.get(&m.id).into_iter().flatten() {
            if p.result == Some(MatchResult::Win)
                && let Some(i) = index.get(&p.participant_id)
            {
                *keys.entry(*i).or_default() += 1.0;
            }
        }
    }
    let last = finished
        .iter()
        .max_by_key(|m| (bracket_rank(m.bracket), m.round, m.number));
    if let Some(last) = last {
        for p in by_match.get(&last.id).into_iter().flatten() {
            if let Some(i) = index.get(&p.participant_id) {
                let bonus = if p.result == Some(MatchResult::Win) {
                    1_000_000.0
                } else {
                    100_000.0
                };
                *keys.entry(*i).or_default() += bonus;
            }
        }
    }
    keys
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{MatchType, StepRules, StepStatus};

    fn step(format: StepFormat, tiebreak: serde_json::Value) -> Step {
        Step {
            id: Uuid::nil(),
            tournament_id: Uuid::nil(),
            position: 1,
            format,
            match_type: MatchType::Duel,
            group_count: 1,
            group_size: 4,
            matches_per_group: 1,
            advance_per_group: 1,
            tiebreak,
            rules: StepRules::default(),
            status: StepStatus::Ongoing,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn member(id: Uuid, points: f64) -> StepParticipant {
        StepParticipant {
            step_id: Uuid::nil(),
            participant_id: id,
            group_id: Uuid::nil(),
            points,
            final_rank: None,
            status: crate::store::StepParticipantStatus::In,
            seed: None,
        }
    }

    fn finished(winner: Uuid, loser: Uuid) -> (Match, Vec<MatchParticipant>) {
        let id = Uuid::new_v4();
        let m = Match {
            id,
            game_id: Uuid::nil(),
            step_id: Uuid::nil(),
            group_id: None,
            round: Some(1),
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
            status: MatchStatus::Finished,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let part = |p: Uuid, rank: i32, result| MatchParticipant {
            match_id: id,
            participant_id: p,
            stats: serde_json::json!({}),
            points: 0.0,
            rank: Some(rank),
            result: Some(result),
            slot: None,
            games_won: None,
        };
        (
            m,
            vec![
                part(winner, 1, MatchResult::Win),
                part(loser, 2, MatchResult::Loss),
            ],
        )
    }

    fn run(
        step: &Step,
        members: &[StepParticipant],
        games: &[(Match, Vec<MatchParticipant>)],
    ) -> Vec<(Uuid, bool)> {
        let refs: Vec<&StepParticipant> = members.iter().collect();
        let matches: Vec<&Match> = games.iter().map(|(m, _)| m).collect();
        let by_match: HashMap<Uuid, Vec<&MatchParticipant>> = games
            .iter()
            .map(|(m, p)| (m.id, p.iter().collect()))
            .collect();
        rank_group(step, &refs, &matches, &by_match, &HashMap::new())
    }

    #[test]
    fn head_to_head_breaks_a_points_tie() {
        let (a, b) = (Uuid::from_u128(1), Uuid::from_u128(2));
        let members = [member(a, 3.0), member(b, 3.0)];
        let games = [finished(b, a)];
        let step = step(StepFormat::Pool, serde_json::json!(["head_to_head"]));
        let ranked = run(&step, &members, &games);
        assert_eq!(ranked, vec![(b, false), (a, false)]);
    }

    #[test]
    fn without_criteria_ties_share_the_rank_and_follow_registration() {
        let (a, b) = (Uuid::from_u128(1), Uuid::from_u128(2));
        let members = [member(a, 3.0), member(b, 3.0)];
        let step = step(StepFormat::Pool, serde_json::json!([]));
        assert_eq!(run(&step, &members, &[]), vec![(a, false), (b, true)]);
    }

    #[test]
    fn elimination_ranks_the_final_winner_first() {
        let (a, b, c) = (Uuid::from_u128(1), Uuid::from_u128(2), Uuid::from_u128(3));
        let members = [member(a, 0.0), member(b, 0.0), member(c, 0.0)];
        let (mut semi, semi_members) = finished(c, a);
        semi.round = Some(1);
        let (mut last, last_members) = finished(c, b);
        last.round = Some(2);
        let games = [(semi, semi_members), (last, last_members)];
        let step = step(StepFormat::SingleElim, serde_json::json!([]));
        let ranked = run(&step, &members, &games);
        assert_eq!(ranked[0].0, c);
        assert_eq!(ranked[1].0, b);
    }
}
