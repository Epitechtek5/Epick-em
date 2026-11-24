//! Classement d'une étape : points, puis critères de départage dans l'ordre configuré
//! (confrontation directe, différentiel de manches, Buchholz).

use std::collections::{HashMap, HashSet};

/// Critère de départage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tiebreak {
    HeadToHead,
    GameDifferential,
    Buchholz,
}

impl Tiebreak {
    /// Reconnaît la clé d'un critère ; les autres clés ne sont pas évaluées.
    pub fn parse(key: &str) -> Option<Self> {
        match key {
            "head_to_head" => Some(Self::HeadToHead),
            "game_differential" => Some(Self::GameDifferential),
            "buchholz" => Some(Self::Buchholz),
            _ => None,
        }
    }
}

/// Un participant d'un match terminé.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Entry {
    pub player: usize,
    pub rank: Option<i32>,
    pub games_won: Option<i32>,
}

/// Match terminé : ses participants (un seul pour un bye).
pub type FinishedMatch = Vec<Entry>;

/// Joueur classé ; `tied` vaut `true` quand il partage le rang du précédent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ranked {
    pub player: usize,
    pub tied: bool,
}

/// Classe `players` (donnés dans l'ordre d'inscription, qui sert de dernier départage) selon
/// `points`, puis les critères. Les égalités restantes partagent le rang (`tied`).
pub fn rank(
    players: &[usize],
    points: &HashMap<usize, f64>,
    matches: &[FinishedMatch],
    criteria: &[Tiebreak],
) -> Vec<Ranked> {
    let score = |p: usize| points.get(&p).copied().unwrap_or(0.0);
    let mut order: Vec<usize> = players.to_vec();
    order.sort_by(|a, b| score(*b).total_cmp(&score(*a)));
    let mut ranked = Vec::with_capacity(order.len());
    let mut start = 0;
    while start < order.len() {
        let mut end = start + 1;
        while end < order.len() && score(order[end]) == score(order[start]) {
            end += 1;
        }
        for group in split_ties(&order[start..end], points, matches, criteria) {
            for (i, player) in group.into_iter().enumerate() {
                ranked.push(Ranked {
                    player,
                    tied: i > 0,
                });
            }
        }
        start = end;
    }
    ranked
}

/// Découpe un groupe à égalité en sous-groupes ordonnés, en appliquant les critères ; chaque
/// sous-groupe garde l'ordre d'entrée.
fn split_ties(
    group: &[usize],
    points: &HashMap<usize, f64>,
    matches: &[FinishedMatch],
    criteria: &[Tiebreak],
) -> Vec<Vec<usize>> {
    if group.len() < 2 {
        return vec![group.to_vec()];
    }
    let Some((criterion, rest)) = criteria.split_first() else {
        return vec![group.to_vec()];
    };
    let mut sorted: Vec<(usize, f64)> = group
        .iter()
        .map(|p| (*p, value(*criterion, *p, group, points, matches)))
        .collect();
    sorted.sort_by(|a, b| b.1.total_cmp(&a.1));
    let mut out = Vec::new();
    let mut start = 0;
    while start < sorted.len() {
        let mut end = start + 1;
        while end < sorted.len() && sorted[end].1 == sorted[start].1 {
            end += 1;
        }
        let tied: Vec<usize> = sorted[start..end].iter().map(|(p, _)| *p).collect();
        out.extend(split_ties(&tied, points, matches, rest));
        start = end;
    }
    out
}

fn value(
    criterion: Tiebreak,
    player: usize,
    tied: &[usize],
    points: &HashMap<usize, f64>,
    matches: &[FinishedMatch],
) -> f64 {
    let mine = |m: &&FinishedMatch| m.iter().any(|e| e.player == player);
    match criterion {
        Tiebreak::HeadToHead => {
            let set: HashSet<usize> = tied.iter().copied().collect();
            let mut total = 0.0;
            for m in matches.iter().filter(mine) {
                let Some(me) = m.iter().find(|e| e.player == player) else {
                    continue;
                };
                for other in m
                    .iter()
                    .filter(|e| e.player != player && set.contains(&e.player))
                {
                    total += match (me.rank, other.rank) {
                        (Some(a), Some(b)) if a < b => 1.0,
                        (Some(a), Some(b)) if a == b => 0.5,
                        _ => 0.0,
                    };
                }
            }
            total
        }
        Tiebreak::GameDifferential => {
            let mut total = 0.0;
            for m in matches.iter().filter(mine).filter(|m| m.len() == 2) {
                let Some(me) = m.iter().find(|e| e.player == player) else {
                    continue;
                };
                let Some(other) = m.iter().find(|e| e.player != player) else {
                    continue;
                };
                total += match (me.games_won, other.games_won) {
                    (Some(a), Some(b)) => f64::from(a - b),
                    _ => match (me.rank, other.rank) {
                        (Some(a), Some(b)) if a < b => 1.0,
                        (Some(a), Some(b)) if a > b => -1.0,
                        _ => 0.0,
                    },
                };
            }
            total
        }
        Tiebreak::Buchholz => matches
            .iter()
            .filter(mine)
            .flat_map(|m| m.iter().filter(|e| e.player != player))
            .map(|e| points.get(&e.player).copied().unwrap_or(0.0))
            .sum(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn duel(winner: usize, loser: usize, games: Option<(i32, i32)>) -> FinishedMatch {
        vec![
            Entry {
                player: winner,
                rank: Some(1),
                games_won: games.map(|g| g.0),
            },
            Entry {
                player: loser,
                rank: Some(2),
                games_won: games.map(|g| g.1),
            },
        ]
    }

    fn pts(values: &[(usize, f64)]) -> HashMap<usize, f64> {
        values.iter().copied().collect()
    }

    fn order(ranked: &[Ranked]) -> Vec<usize> {
        ranked.iter().map(|r| r.player).collect()
    }

    #[test]
    fn points_decide_first_and_registration_order_last() {
        let ranked = rank(&[0, 1, 2], &pts(&[(0, 1.0), (1, 3.0), (2, 1.0)]), &[], &[]);
        assert_eq!(order(&ranked), vec![1, 0, 2]);
        assert!(!ranked[1].tied);
        assert!(ranked[2].tied);
    }

    #[test]
    fn head_to_head_separates_players_level_on_points() {
        let matches = vec![duel(1, 0, None)];
        let ranked = rank(
            &[0, 1],
            &pts(&[(0, 3.0), (1, 3.0)]),
            &matches,
            &[Tiebreak::HeadToHead],
        );
        assert_eq!(order(&ranked), vec![1, 0]);
        assert!(!ranked[1].tied);
    }

    #[test]
    fn game_differential_uses_games_won() {
        let matches = vec![duel(0, 2, Some((2, 0))), duel(1, 3, Some((2, 1)))];
        let ranked = rank(
            &[1, 0],
            &pts(&[(0, 3.0), (1, 3.0)]),
            &matches,
            &[Tiebreak::GameDifferential],
        );
        assert_eq!(order(&ranked), vec![0, 1]);
    }

    #[test]
    fn buchholz_rewards_a_stronger_schedule() {
        let matches = vec![duel(0, 2, None), duel(1, 3, None)];
        let ranked = rank(
            &[1, 0],
            &pts(&[(0, 3.0), (1, 3.0), (2, 5.0), (3, 0.0)]),
            &matches,
            &[Tiebreak::Buchholz],
        );
        assert_eq!(order(&ranked), vec![0, 1]);
    }

    #[test]
    fn criteria_apply_in_order() {
        // Aucune confrontation directe : le Buchholz décide.
        let matches = vec![duel(0, 2, None), duel(1, 3, None)];
        let ranked = rank(
            &[0, 1],
            &pts(&[(0, 3.0), (1, 3.0), (2, 0.0), (3, 4.0)]),
            &matches,
            &[Tiebreak::HeadToHead, Tiebreak::Buchholz],
        );
        assert_eq!(order(&ranked), vec![1, 0]);
    }

    #[test]
    fn unknown_keys_are_not_criteria() {
        assert_eq!(Tiebreak::parse("buchholz"), Some(Tiebreak::Buchholz));
        assert_eq!(Tiebreak::parse("wins"), None);
    }
}
