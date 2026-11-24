//! Résolution des pronostics de match et des questions de Pick'em.
//!
//! Fonctions pures : elles reçoivent l'état connu (issue d'un match, qualifiés d'une étape,
//! vainqueur d'un tournoi…) et renvoient l'issue d'un pronostic et ses points. Les points sont
//! toujours **recalculés à partir de l'état**, jamais incrémentés : résoudre deux fois donne le
//! même résultat (ADR-002, règle 2), et une correction de résultat se répercute en résolvant de
//! nouveau.
//!
//! Les identifiants des participants sont génériques (`P`) pour garder la crate sans dépendance.

/// Points d'un vainqueur de duel bien pronostiqué.
pub const WINNER_POINTS: f64 = 10.0;
/// Points d'un participant placé au rang exact dans un classement pronostiqué (FFA).
pub const EXACT_RANK_POINTS: f64 = 5.0;
/// Points d'un participant placé à un rang près dans un classement pronostiqué (FFA).
pub const NEAR_RANK_POINTS: f64 = 2.0;

/// Issue d'un pronostic ou d'une réponse de Pick'em.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Le résultat n'est pas encore connu.
    Pending,
    /// Entièrement juste.
    Correct,
    /// En partie juste (classement ou liste de qualifiés).
    Partial,
    Incorrect,
    /// Sans objet : match annulé ou supprimé, question impossible à trancher. Aucun point.
    Void,
}

impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Pending => "pending",
            Outcome::Correct => "correct",
            Outcome::Partial => "partial",
            Outcome::Incorrect => "incorrect",
            Outcome::Void => "void",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "pending" => Outcome::Pending,
            "correct" => Outcome::Correct,
            "partial" => Outcome::Partial,
            "incorrect" => Outcome::Incorrect,
            "void" => Outcome::Void,
            _ => return None,
        })
    }

    /// L'issue est-elle définitive (rien ne la changera sans correction de résultat) ?
    pub fn is_final(self) -> bool {
        self != Outcome::Pending
    }
}

/// Issue d'un pronostic et ses points (`0` tant qu'il n'est pas résolu).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Score {
    pub outcome: Outcome,
    pub points: f64,
}

impl Score {
    pub const PENDING: Score = Score {
        outcome: Outcome::Pending,
        points: 0.0,
    };
    pub const VOID: Score = Score {
        outcome: Outcome::Void,
        points: 0.0,
    };

    fn of(earned: f64, max: f64) -> Score {
        let outcome = if earned <= 0.0 {
            Outcome::Incorrect
        } else if earned >= max {
            Outcome::Correct
        } else {
            Outcome::Partial
        };
        Score {
            outcome,
            points: earned,
        }
    }
}

/// État d'un match, vu par la résolution.
#[derive(Debug, Clone, PartialEq)]
pub enum MatchState<P> {
    /// Pas encore terminé.
    Pending,
    /// Annulé ou disparu : les pronostics sont sans objet.
    Void,
    /// Terminé : rang de chaque participant (1 = premier) quand il est connu, et vainqueur
    /// (aucun en cas d'égalité).
    Finished {
        ranks: Vec<(P, Option<i32>)>,
        winner: Option<P>,
    },
}

/// Pronostic du vainqueur d'un duel : [`WINNER_POINTS`] s'il est juste ; un match nul ne donne
/// raison à personne.
pub fn score_winner<P: PartialEq>(predicted: &P, state: &MatchState<P>) -> Score {
    match state {
        MatchState::Pending => Score::PENDING,
        MatchState::Void => Score::VOID,
        MatchState::Finished { winner, .. } => {
            let earned = if winner.as_ref() == Some(predicted) {
                WINNER_POINTS
            } else {
                0.0
            };
            Score::of(earned, WINNER_POINTS)
        }
    }
}

/// Pronostic d'un classement (FFA), du premier au dernier pronostiqué : chaque participant au
/// rang exact rapporte [`EXACT_RANK_POINTS`], à un rang près [`NEAR_RANK_POINTS`]. Un match
/// terminé sans aucun rang connu est sans objet.
pub fn score_ranking<P: PartialEq>(predicted: &[P], state: &MatchState<P>) -> Score {
    let ranks = match state {
        MatchState::Pending => return Score::PENDING,
        MatchState::Void => return Score::VOID,
        MatchState::Finished { ranks, .. } => ranks,
    };
    if predicted.is_empty() || ranks.iter().all(|(_, rank)| rank.is_none()) {
        return Score::VOID;
    }
    let earned: f64 = predicted
        .iter()
        .enumerate()
        .map(|(index, participant)| {
            let guess = i32::try_from(index + 1).unwrap_or(i32::MAX);
            let actual = ranks
                .iter()
                .find(|(p, _)| p == participant)
                .and_then(|(_, rank)| *rank);
            match actual.map(|rank| (rank - guess).abs()) {
                Some(0) => EXACT_RANK_POINTS,
                Some(1) => NEAR_RANK_POINTS,
                _ => 0.0,
            }
        })
        .sum();
    Score::of(earned, EXACT_RANK_POINTS * predicted.len() as f64)
}

/// Question à réponse unique (vainqueur du tournoi, meilleur marqueur…) : `points` si le choix
/// est parmi les bonnes réponses (plusieurs en cas d'égalité). `None` : pas encore tranchée ;
/// une liste vide : impossible à trancher.
pub fn score_pick<P: PartialEq>(picked: &P, answers: Option<&[P]>, points: f64) -> Score {
    match answers {
        None => Score::PENDING,
        Some([]) => Score::VOID,
        Some(answers) => {
            let earned = if answers.contains(picked) {
                points
            } else {
                0.0
            };
            Score::of(earned, points)
        }
    }
}

/// Question à plusieurs réponses (qualifiés d'une étape…) : `points` répartis sur les
/// `expected` bonnes réponses attendues, chaque bon choix en rapportant une part. Les doublons
/// ne comptent qu'une fois.
pub fn score_set<P: PartialEq>(
    picked: &[P],
    answers: Option<&[P]>,
    expected: usize,
    points: f64,
) -> Score {
    let answers = match answers {
        None => return Score::PENDING,
        Some([]) => return Score::VOID,
        Some(answers) => answers,
    };
    let expected = expected.max(1);
    let mut seen: Vec<&P> = Vec::new();
    let mut hits = 0usize;
    for participant in picked {
        if seen.contains(&participant) {
            continue;
        }
        seen.push(participant);
        if answers.contains(participant) {
            hits += 1;
        }
    }
    let hits = hits.min(expected);
    Score::of(points * hits as f64 / expected as f64, points)
}

/// Participants ex æquo en tête (les plus grands `value`). Vide si `entries` l'est.
pub fn leaders<P: Clone>(entries: &[(P, f64)]) -> Vec<P> {
    let Some(best) = entries.iter().map(|(_, v)| *v).reduce(f64::max) else {
        return Vec::new();
    };
    entries
        .iter()
        .filter(|(_, v)| *v == best)
        .map(|(p, _)| p.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn finished(ranks: &[(u8, Option<i32>)], winner: Option<u8>) -> MatchState<u8> {
        MatchState::Finished {
            ranks: ranks.to_vec(),
            winner,
        }
    }

    #[test]
    fn winner_predictions() {
        let state = finished(&[(1, Some(1)), (2, Some(2))], Some(1));
        assert_eq!(
            score_winner(&1, &state),
            Score {
                outcome: Outcome::Correct,
                points: WINNER_POINTS
            }
        );
        assert_eq!(score_winner(&2, &state).outcome, Outcome::Incorrect);
        assert_eq!(score_winner(&2, &state).points, 0.0);
        // Match nul : personne n'a raison.
        let draw = finished(&[(1, Some(1)), (2, Some(1))], None);
        assert_eq!(score_winner(&1, &draw).outcome, Outcome::Incorrect);
        assert_eq!(score_winner(&1, &MatchState::Pending), Score::PENDING);
        assert_eq!(score_winner(&1, &MatchState::Void), Score::VOID);
    }

    #[test]
    fn ranking_predictions_reward_exact_and_near_ranks() {
        let state = finished(
            &[(1, Some(1)), (2, Some(2)), (3, Some(3)), (4, Some(4))],
            Some(1),
        );
        let exact = score_ranking(&[1, 2, 3], &state);
        assert_eq!(exact.outcome, Outcome::Correct);
        assert_eq!(exact.points, 3.0 * EXACT_RANK_POINTS);
        // 2 et 1 inversés, 4 troisième au lieu de quatrième : chacun à un rang près.
        let near = score_ranking(&[2, 1, 4], &state);
        assert_eq!(near.outcome, Outcome::Partial);
        assert_eq!(near.points, 3.0 * NEAR_RANK_POINTS);
        let mixed = score_ranking(&[1, 4], &state);
        assert_eq!(mixed.points, EXACT_RANK_POINTS);
        let wrong = score_ranking(&[3, 4], &state);
        assert_eq!(wrong.outcome, Outcome::Incorrect);
        // Sans aucun rang connu, le pronostic est sans objet.
        let unranked = finished(&[(1, None), (2, None)], None);
        assert_eq!(score_ranking(&[1, 2], &unranked), Score::VOID);
    }

    #[test]
    fn single_answer_questions_accept_ties() {
        assert_eq!(score_pick(&1, None, 20.0), Score::PENDING);
        assert_eq!(score_pick::<u8>(&1, Some(&[]), 20.0), Score::VOID);
        assert_eq!(score_pick(&1, Some(&[1, 2]), 20.0).points, 20.0);
        assert_eq!(
            score_pick(&3, Some(&[1, 2]), 20.0).outcome,
            Outcome::Incorrect
        );
    }

    #[test]
    fn set_questions_share_points_between_expected_answers() {
        let answers = [1, 2, 3, 4];
        let half = score_set(&[1, 2, 9, 9], Some(&answers), 4, 20.0);
        assert_eq!(half.outcome, Outcome::Partial);
        assert_eq!(half.points, 10.0);
        // Un doublon ne compte qu'une fois.
        assert_eq!(
            score_set(&[1, 1, 1, 1], Some(&answers), 4, 20.0).points,
            5.0
        );
        assert_eq!(
            score_set(&[4, 3, 2, 1], Some(&answers), 4, 20.0).outcome,
            Outcome::Correct
        );
        assert_eq!(score_set(&[1], None, 4, 20.0), Score::PENDING);
    }

    #[test]
    fn resolving_twice_gives_the_same_score() {
        let state = finished(&[(1, Some(2)), (2, Some(1))], Some(2));
        assert_eq!(score_winner(&2, &state), score_winner(&2, &state));
        assert_eq!(
            score_ranking(&[2, 1], &state),
            score_ranking(&[2, 1], &state)
        );
    }

    #[test]
    fn leaders_keep_ties() {
        assert_eq!(leaders(&[(1, 3.0), (2, 7.0), (3, 7.0)]), vec![2, 3]);
        assert!(leaders::<u8>(&[]).is_empty());
    }

    #[test]
    fn outcomes_round_trip() {
        for outcome in [
            Outcome::Pending,
            Outcome::Correct,
            Outcome::Partial,
            Outcome::Incorrect,
            Outcome::Void,
        ] {
            assert_eq!(Outcome::parse(outcome.as_str()), Some(outcome));
        }
        assert_eq!(Outcome::parse("won"), None);
    }
}
