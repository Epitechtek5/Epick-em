//! Appariement d'une ronde suisse à partir du classement courant.

use std::collections::HashSet;

/// Participant à apparier ; la liste est donnée dans l'ordre du classement (meilleur d'abord).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SwissPlayer {
    /// Identifiant de l'appelant (rang d'inscription par exemple).
    pub id: usize,
    pub points: f64,
    pub had_bye: bool,
}

/// Une ronde : paires et participant exempt s'il y en a un.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwissRound {
    pub pairs: Vec<(usize, usize)>,
    pub bye: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PairingError {
    /// Aucun appariement sans revanche n'existe pour cette ronde.
    Impossible,
}

const SEARCH_BUDGET: usize = 200_000;

/// Apparie la ronde : on joue dans son groupe de points (le haut de groupe contre le bas), sans
/// revanche tant que c'est possible. `played` contient les couples déjà opposés, plus petit
/// identifiant en premier. Avec `allow_rematch`, un appariement avec revanche est accepté quand
/// aucun autre n'existe. Le nombre impair donne un bye au dernier du classement qui n'en a pas
/// encore eu.
pub fn pair_round(
    players: &[SwissPlayer],
    played: &HashSet<(usize, usize)>,
    allow_rematch: bool,
) -> Result<SwissRound, PairingError> {
    let attempt = |forbid: bool| -> Option<SwissRound> {
        let mut bye_candidates: Vec<Option<usize>> = Vec::new();
        if players.len() % 2 == 1 {
            // Du dernier au premier, ceux qui n'ont pas encore été exempts d'abord.
            let mut order: Vec<usize> = (0..players.len()).rev().collect();
            order.sort_by_key(|i| players[*i].had_bye);
            bye_candidates.extend(order.into_iter().map(Some));
        } else {
            bye_candidates.push(None);
        }
        for bye in bye_candidates {
            let remaining: Vec<usize> = (0..players.len()).filter(|i| Some(*i) != bye).collect();
            let mut budget = SEARCH_BUDGET;
            let mut pairs = Vec::new();
            if search(players, &remaining, played, forbid, &mut pairs, &mut budget) {
                return Some(SwissRound {
                    pairs: pairs
                        .into_iter()
                        .map(|(a, b)| (players[a].id, players[b].id))
                        .collect(),
                    bye: bye.map(|i| players[i].id),
                });
            }
        }
        None
    };
    attempt(true)
        .or_else(|| if allow_rematch { attempt(false) } else { None })
        .ok_or(PairingError::Impossible)
}

fn search(
    players: &[SwissPlayer],
    remaining: &[usize],
    played: &HashSet<(usize, usize)>,
    forbid: bool,
    pairs: &mut Vec<(usize, usize)>,
    budget: &mut usize,
) -> bool {
    let Some((&first, rest)) = remaining.split_first() else {
        return true;
    };
    if *budget == 0 {
        return false;
    }
    *budget -= 1;
    // Adversaires dans l'ordre de préférence : le groupe de points de `first` en partant de sa
    // moitié (haut contre bas), puis le reste dans l'ordre du classement.
    let same: Vec<usize> = rest
        .iter()
        .copied()
        .take_while(|i| players[*i].points == players[first].points)
        .collect();
    let mid = same.len().div_ceil(2).saturating_sub(1);
    let mut candidates: Vec<usize> = Vec::with_capacity(rest.len());
    candidates.extend(same[mid..].iter());
    candidates.extend(same[..mid].iter().rev());
    candidates.extend(rest.iter().skip(same.len()));
    for opponent in candidates {
        let key = (
            players[first].id.min(players[opponent].id),
            players[first].id.max(players[opponent].id),
        );
        if forbid && played.contains(&key) {
            continue;
        }
        let next: Vec<usize> = rest.iter().copied().filter(|i| *i != opponent).collect();
        pairs.push((first, opponent));
        if search(players, &next, played, forbid, pairs, budget) {
            return true;
        }
        pairs.pop();
        if *budget == 0 {
            return false;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn players(points: &[f64]) -> Vec<SwissPlayer> {
        points
            .iter()
            .enumerate()
            .map(|(id, p)| SwissPlayer {
                id,
                points: *p,
                had_bye: false,
            })
            .collect()
    }

    #[test]
    fn the_first_round_folds_the_field() {
        let round = pair_round(&players(&[0.0; 8]), &HashSet::new(), false).unwrap();
        assert_eq!(round.pairs.len(), 4);
        assert_eq!(round.bye, None);
        assert_eq!(round.pairs[0], (0, 4));
    }

    #[test]
    fn score_groups_play_each_other() {
        let round = pair_round(&players(&[3.0, 3.0, 0.0, 0.0]), &HashSet::new(), false).unwrap();
        assert!(round.pairs.contains(&(0, 1)));
        assert!(round.pairs.contains(&(2, 3)));
    }

    #[test]
    fn rematches_are_avoided_when_possible() {
        let played: HashSet<(usize, usize)> = [(0, 1), (2, 3)].into_iter().collect();
        let round = pair_round(&players(&[3.0, 3.0, 0.0, 0.0]), &played, false).unwrap();
        assert!(!round.pairs.contains(&(0, 1)));
        assert!(!round.pairs.contains(&(2, 3)));
        assert_eq!(round.pairs.len(), 2);
    }

    #[test]
    fn an_odd_field_gives_the_bye_to_the_last_without_one() {
        let mut field = players(&[3.0, 2.0, 1.0]);
        field[2].had_bye = true;
        let round = pair_round(&field, &HashSet::new(), false).unwrap();
        assert_eq!(round.bye, Some(1));
        assert_eq!(round.pairs, vec![(0, 2)]);
    }

    #[test]
    fn impossible_pairings_are_reported_unless_rematches_are_allowed() {
        let played: HashSet<(usize, usize)> = [(0, 1), (0, 2), (1, 2)].into_iter().collect();
        let field = players(&[2.0, 1.0, 0.0]);
        assert_eq!(
            pair_round(&field, &played, false),
            Err(PairingError::Impossible)
        );
        assert!(pair_round(&field, &played, true).is_ok());
    }

    #[test]
    fn every_participant_is_paired_once() {
        for count in 2..=21 {
            let field = players(&vec![0.0; count]);
            let round = pair_round(&field, &HashSet::new(), false).unwrap();
            let mut seen: Vec<usize> = round.pairs.iter().flat_map(|(a, b)| [*a, *b]).collect();
            seen.extend(round.bye);
            seen.sort_unstable();
            assert_eq!(seen, (0..count).collect::<Vec<_>>());
        }
    }
}
