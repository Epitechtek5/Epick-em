//! Calcul des points d'un barème et des classements d'un tournoi.
//!
//! Fonctions pures : les points de chaque inscrit viennent du store
//! ([`AuthStore::participant_points`](crate::store::AuthStore::participant_points)), les règles
//! de barème convertissent la valeur d'une statistique en points pour les étapes (#52).

use crate::store::{ScoringMode, ScoringRule, TeamScoringMode};
use serde_json::Value;

impl ScoringRule {
    /// Points rapportés par `value` : `valeur × coefficient` en mode `linear`, entrée de la
    /// table en mode `table` (0 si la valeur n'y figure pas).
    pub fn points_for(&self, value: f64) -> f64 {
        match self.mode {
            ScoringMode::Linear => value * self.coefficient.unwrap_or(0.0),
            ScoringMode::Table => self
                .points_table
                .as_ref()
                .and_then(Value::as_object)
                .and_then(|table| {
                    table
                        .iter()
                        .find(|(key, _)| key.parse::<f64>().is_ok_and(|k| k == value))
                })
                .and_then(|(_, points)| points.as_f64())
                .unwrap_or(0.0),
        }
    }
}

/// Points d'une équipe à partir de ceux de ses joueurs : `none` ne compte rien, `sum` additionne
/// tout le monde, `best` ne garde que le meilleur, `top_n` additionne les `n` meilleurs.
pub fn team_points(mode: TeamScoringMode, n: Option<i32>, members: &[f64]) -> f64 {
    let mut sorted = members.to_vec();
    sorted.sort_by(|a, b| b.total_cmp(a));
    match mode {
        TeamScoringMode::None => 0.0,
        TeamScoringMode::Sum => sorted.iter().sum(),
        TeamScoringMode::Best => sorted.first().copied().unwrap_or(0.0),
        TeamScoringMode::TopN => sorted
            .iter()
            .take(usize::try_from(n.unwrap_or(0)).unwrap_or(0))
            .sum(),
    }
}

/// Classe les entrées par points décroissants ; les ex æquo partagent le même rang et le rang
/// suivant est sauté (1, 2, 2, 4). À points égaux, l'ordre d'entrée est conservé.
pub fn rank<T>(mut entries: Vec<(T, f64)>) -> Vec<(u32, T, f64)> {
    entries.sort_by(|a, b| b.1.total_cmp(&a.1));
    let mut ranked: Vec<(u32, T, f64)> = Vec::with_capacity(entries.len());
    for (index, (entry, points)) in entries.into_iter().enumerate() {
        let rank = match ranked.last() {
            Some(previous) if previous.2 == points => previous.0,
            _ => u32::try_from(index + 1).unwrap_or(u32::MAX),
        };
        ranked.push((rank, entry, points));
    }
    ranked
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    fn rule(mode: ScoringMode, coefficient: Option<f64>, table: Option<Value>) -> ScoringRule {
        ScoringRule {
            id: Uuid::nil(),
            tournament_id: Uuid::nil(),
            stat_id: Uuid::nil(),
            mode,
            coefficient,
            points_table: table,
        }
    }

    #[test]
    fn linear_rules_multiply_by_the_coefficient() {
        let kills = rule(ScoringMode::Linear, Some(1.5), None);
        assert_eq!(kills.points_for(4.0), 6.0);
        assert_eq!(kills.points_for(0.0), 0.0);
    }

    #[test]
    fn table_rules_look_the_value_up() {
        let placement = rule(
            ScoringMode::Table,
            None,
            Some(json!({"1": 8, "2": 7, "8": 1})),
        );
        assert_eq!(placement.points_for(1.0), 8.0);
        assert_eq!(placement.points_for(8.0), 1.0);
        assert_eq!(placement.points_for(5.0), 0.0);
    }

    #[test]
    fn team_points_follow_the_scoring_mode() {
        let members = [3.0, 9.0, 5.0, 1.0];
        assert_eq!(team_points(TeamScoringMode::None, None, &members), 0.0);
        assert_eq!(team_points(TeamScoringMode::Sum, None, &members), 18.0);
        assert_eq!(team_points(TeamScoringMode::Best, None, &members), 9.0);
        assert_eq!(team_points(TeamScoringMode::TopN, Some(2), &members), 14.0);
        assert_eq!(team_points(TeamScoringMode::TopN, Some(9), &members), 18.0);
        assert_eq!(team_points(TeamScoringMode::Best, None, &[]), 0.0);
    }

    #[test]
    fn ties_share_a_rank_and_skip_the_next() {
        let ranked = rank(vec![("a", 5.0), ("b", 9.0), ("c", 5.0), ("d", 1.0)]);
        let ranks: Vec<(u32, &str)> = ranked.iter().map(|(r, name, _)| (*r, *name)).collect();
        assert_eq!(ranks, [(1, "b"), (2, "a"), (2, "c"), (4, "d")]);
        assert!(rank::<&str>(Vec::new()).is_empty());
    }
}
