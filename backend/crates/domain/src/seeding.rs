//! Répartition des participants classés en groupes, et BO.

/// Répartit des participants déjà ordonnés par tête de série dans `group_count` groupes en
/// serpentin (1, 2, ..., n, n, ..., 2, 1) : les groupes sont équilibrés en force. Chaque groupe
/// garde l'ordre des têtes de série.
pub fn snake_groups<T: Copy>(ordered: &[T], group_count: usize) -> Vec<Vec<T>> {
    let count = group_count.max(1);
    let mut groups = vec![Vec::new(); count];
    for (index, item) in ordered.iter().enumerate() {
        let lap = index / count;
        let column = index % count;
        let target = if lap.is_multiple_of(2) {
            column
        } else {
            count - 1 - column
        };
        groups[target].push(*item);
    }
    groups
}

/// Manches à gagner pour remporter une série au meilleur de `best_of`.
pub fn games_to_win(best_of: i32) -> i32 {
    best_of / 2 + 1
}

/// Une série est valide quand le vainqueur atteint `games_to_win` et que le perdant reste en
/// dessous.
pub fn series_is_decided(best_of: i32, winner_games: i32, loser_games: i32) -> bool {
    let need = games_to_win(best_of);
    winner_games == need && (0..need).contains(&loser_games)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_are_dealt_in_a_snake() {
        let groups = snake_groups(&[1, 2, 3, 4, 5, 6, 7, 8], 4);
        assert_eq!(groups, vec![vec![1, 8], vec![2, 7], vec![3, 6], vec![4, 5]]);
    }

    #[test]
    fn a_single_group_keeps_the_order() {
        assert_eq!(snake_groups(&[3, 1, 2], 1), vec![vec![3, 1, 2]]);
    }

    #[test]
    fn series_are_won_by_majority() {
        assert_eq!(games_to_win(1), 1);
        assert_eq!(games_to_win(3), 2);
        assert_eq!(games_to_win(5), 3);
        assert!(series_is_decided(3, 2, 1));
        assert!(series_is_decided(5, 3, 0));
        assert!(!series_is_decided(3, 2, 2));
        assert!(!series_is_decided(5, 2, 1));
        assert!(!series_is_decided(1, 0, 1));
    }
}
