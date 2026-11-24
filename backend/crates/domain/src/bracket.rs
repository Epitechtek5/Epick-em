//! Génération des structures de compétition : élimination simple et double, round-robin.
//!
//! Tout est calculé sur des rangs de tête de série (0 = meilleure tête de série) : la couche
//! appelante associe ces rangs aux inscrits. Aucune I/O.

/// Tableau d'un match d'élimination.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum BracketKind {
    Winners,
    Losers,
    GrandFinal,
}

/// Match planifié. `winner_to` et `loser_to` désignent (rang du match dans la liste, emplacement
/// 0 ou 1) où vont le vainqueur et le perdant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedMatch {
    /// `None` en élimination simple.
    pub bracket: Option<BracketKind>,
    /// Ronde, à partir de 1 (compactée par tableau).
    pub round: i32,
    /// Rang du match dans sa ronde, à partir de 1.
    pub number: i32,
    /// Têtes de série déjà placées ; `None` : le participant vient d'un match précédent.
    pub seeds: [Option<usize>; 2],
    pub winner_to: Option<(usize, usize)>,
    pub loser_to: Option<(usize, usize)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Src {
    Seed(usize),
    Winner(usize),
    Loser(usize),
    Empty,
}

struct Node {
    bracket: Option<BracketKind>,
    round: usize,
    number: usize,
    slots: [Src; 2],
    /// Match jamais supprimé (la manche de « reset » de la finale).
    fixed: bool,
    removed: bool,
    out_winner: Src,
    out_loser: Src,
}

/// Ordre standard des têtes de série au premier tour d'un tableau de `size` places (puissance de
/// 2) : 1 contre `size`, les meilleures têtes de série se retrouvant le plus tard possible.
fn seed_order(size: usize) -> Vec<usize> {
    let mut order = vec![1usize];
    while order.len() < size {
        let total = order.len() * 2 + 1;
        order = order.iter().flat_map(|s| [*s, total - *s]).collect();
    }
    order
}

fn first_round_src(seed_number: usize, count: usize) -> Src {
    if seed_number <= count {
        Src::Seed(seed_number - 1)
    } else {
        Src::Empty
    }
}

fn node(bracket: Option<BracketKind>, round: usize, number: usize, slots: [Src; 2]) -> Node {
    Node {
        bracket,
        round,
        number,
        slots,
        fixed: false,
        removed: false,
        out_winner: Src::Empty,
        out_loser: Src::Empty,
    }
}

/// Supprime les matchs sans adversaire (byes) et propage leurs participants.
fn reduce(nodes: &mut [Node]) {
    loop {
        let mut changed = false;
        for i in 0..nodes.len() {
            if nodes[i].removed {
                continue;
            }
            for s in 0..2 {
                let resolved = match nodes[i].slots[s] {
                    Src::Winner(x) if nodes[x].removed => Some(nodes[x].out_winner),
                    Src::Loser(x) if nodes[x].removed => Some(nodes[x].out_loser),
                    _ => None,
                };
                if let Some(src) = resolved {
                    nodes[i].slots[s] = src;
                    changed = true;
                }
            }
            if nodes[i].fixed {
                continue;
            }
            let [a, b] = nodes[i].slots;
            if a == Src::Empty || b == Src::Empty {
                nodes[i].removed = true;
                nodes[i].out_winner = if a == Src::Empty { b } else { a };
                nodes[i].out_loser = Src::Empty;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
}

/// Ordonne les matchs restants, compacte les rondes et relie vainqueurs et perdants.
fn finish(nodes: Vec<Node>) -> Vec<PlannedMatch> {
    let mut kept: Vec<usize> = (0..nodes.len()).filter(|i| !nodes[*i].removed).collect();
    kept.sort_by_key(|i| (nodes[*i].bracket, nodes[*i].round, nodes[*i].number, *i));
    let position = |old: usize| kept.iter().position(|k| *k == old);

    // Compactage : ronde et rang recomptés parmi les matchs gardés.
    let mut rounds: Vec<(Option<BracketKind>, usize)> = kept
        .iter()
        .map(|i| (nodes[*i].bracket, nodes[*i].round))
        .collect();
    rounds.dedup();
    let mut numbers: std::collections::HashMap<(Option<BracketKind>, usize), i32> =
        std::collections::HashMap::new();
    let mut planned: Vec<PlannedMatch> = kept
        .iter()
        .map(|i| {
            let n = &nodes[*i];
            let key = (n.bracket, n.round);
            let round = rounds
                .iter()
                .filter(|(b, _)| *b == n.bracket)
                .position(|r| *r == key)
                .map_or(1, |p| i32::try_from(p + 1).unwrap_or(i32::MAX));
            let number = numbers.entry(key).or_insert(0);
            *number += 1;
            PlannedMatch {
                bracket: n.bracket,
                round,
                number: *number,
                seeds: [
                    if let Src::Seed(s) = n.slots[0] {
                        Some(s)
                    } else {
                        None
                    },
                    if let Src::Seed(s) = n.slots[1] {
                        Some(s)
                    } else {
                        None
                    },
                ],
                winner_to: None,
                loser_to: None,
            }
        })
        .collect();
    for (new_index, old) in kept.iter().enumerate() {
        for (slot, src) in nodes[*old].slots.iter().enumerate() {
            match src {
                Src::Winner(x) => {
                    if let Some(p) = position(*x) {
                        planned[p].winner_to = Some((new_index, slot));
                    }
                }
                Src::Loser(x) => {
                    if let Some(p) = position(*x) {
                        planned[p].loser_to = Some((new_index, slot));
                    }
                }
                _ => {}
            }
        }
    }
    planned
}

/// Tableau à élimination simple pour `count` participants (au moins 2), byes automatiques :
/// les meilleures têtes de série passent le premier tour quand `count` n'est pas une puissance
/// de 2.
pub fn single_elimination(count: usize) -> Vec<PlannedMatch> {
    if count < 2 {
        return Vec::new();
    }
    let size = count.next_power_of_two();
    let order = seed_order(size);
    let mut nodes: Vec<Node> = Vec::new();
    let mut previous: Vec<usize> = Vec::new();
    for i in 0..size / 2 {
        nodes.push(node(
            None,
            1,
            i + 1,
            [
                first_round_src(order[2 * i], count),
                first_round_src(order[2 * i + 1], count),
            ],
        ));
        previous.push(nodes.len() - 1);
    }
    let mut round = 2;
    while previous.len() > 1 {
        let mut current = Vec::new();
        for pair in previous.chunks(2) {
            nodes.push(node(
                None,
                round,
                current.len() + 1,
                [Src::Winner(pair[0]), Src::Winner(pair[1])],
            ));
            current.push(nodes.len() - 1);
        }
        previous = current;
        round += 1;
    }
    reduce(&mut nodes);
    finish(nodes)
}

/// Tableau à double élimination (tableau des vainqueurs, des perdants, finale et manche de
/// « reset » toujours créée : elle est annulée si le vainqueur du tableau des vainqueurs gagne la
/// finale). Au moins 2 participants.
pub fn double_elimination(count: usize) -> Vec<PlannedMatch> {
    if count < 2 {
        return Vec::new();
    }
    let size = count.next_power_of_two();
    let rounds = size.trailing_zeros() as usize;
    let order = seed_order(size);
    let mut nodes: Vec<Node> = Vec::new();

    // Tableau des vainqueurs : wb[r - 1][i].
    let mut wb: Vec<Vec<usize>> = Vec::new();
    let mut first = Vec::new();
    for i in 0..size / 2 {
        nodes.push(node(
            Some(BracketKind::Winners),
            1,
            i + 1,
            [
                first_round_src(order[2 * i], count),
                first_round_src(order[2 * i + 1], count),
            ],
        ));
        first.push(nodes.len() - 1);
    }
    wb.push(first);
    for r in 2..=rounds {
        let mut current = Vec::new();
        for pair in wb[r - 2].chunks(2) {
            nodes.push(node(
                Some(BracketKind::Winners),
                r,
                current.len() + 1,
                [Src::Winner(pair[0]), Src::Winner(pair[1])],
            ));
            current.push(nodes.len() - 1);
        }
        wb.push(current);
    }

    // Tableau des perdants : un tour de mise en concurrence puis un tour où les perdants du
    // tableau des vainqueurs « descendent ».
    let mut lb: Vec<Vec<usize>> = Vec::new();
    for j in 1..rounds {
        let count_j = size >> (j + 1);
        let mut pairing = Vec::new();
        for i in 0..count_j {
            let slots = if j == 1 {
                [Src::Loser(wb[0][2 * i]), Src::Loser(wb[0][2 * i + 1])]
            } else {
                let prev = &lb[2 * (j - 1) - 1];
                [Src::Winner(prev[2 * i]), Src::Winner(prev[2 * i + 1])]
            };
            nodes.push(node(Some(BracketKind::Losers), 2 * j - 1, i + 1, slots));
            pairing.push(nodes.len() - 1);
        }
        let mut drop_in = Vec::new();
        for (i, feeder) in pairing.iter().enumerate() {
            // Ordre inversé d'un tour sur deux : évite les revanches immédiates.
            let from = &wb[j];
            let dropped = if j % 2 == 1 {
                from[count_j - 1 - i]
            } else {
                from[i]
            };
            nodes.push(node(
                Some(BracketKind::Losers),
                2 * j,
                i + 1,
                [Src::Winner(*feeder), Src::Loser(dropped)],
            ));
            drop_in.push(nodes.len() - 1);
        }
        lb.push(pairing);
        lb.push(drop_in);
    }

    let wb_final = wb[rounds - 1][0];
    let challenger = match lb.last() {
        Some(last) => Src::Winner(last[0]),
        None => Src::Loser(wb_final),
    };
    nodes.push(node(
        Some(BracketKind::GrandFinal),
        1,
        1,
        [Src::Winner(wb_final), challenger],
    ));
    let mut reset = node(
        Some(BracketKind::GrandFinal),
        2,
        1,
        [Src::Empty, Src::Empty],
    );
    reset.fixed = true;
    nodes.push(reset);

    reduce(&mut nodes);
    let mut planned = finish(nodes);
    // La manche de reset est alimentée par la finale (voir `grand_final_outcome`).
    let find = |round: i32| {
        planned
            .iter()
            .position(|m| m.bracket == Some(BracketKind::GrandFinal) && m.round == round)
    };
    if let (Some(gf), Some(rs)) = (find(1), find(2)) {
        planned[gf].winner_to = Some((rs, 0));
        planned[gf].loser_to = Some((rs, 1));
    }
    planned
}

/// Issue de la finale d'une double élimination : `Some(true)` quand le vainqueur du tableau des
/// vainqueurs (emplacement 0) l'emporte — le tournoi est joué et la manche de reset annulée —,
/// `Some(false)` quand le vainqueur du tableau des perdants l'emporte (reset à jouer).
pub fn grand_final_ends_tournament(winner_slot: usize) -> bool {
    winner_slot == 0
}

/// Appariements d'un round-robin à `count` participants (cercle de Berger) : une ronde par liste,
/// chaque participant rencontre tous les autres une fois. Avec un nombre impair, un participant
/// est exempt à chaque ronde (absent des paires).
pub fn round_robin(count: usize) -> Vec<Vec<(usize, usize)>> {
    if count < 2 {
        return Vec::new();
    }
    let mut ring: Vec<Option<usize>> = (0..count).map(Some).collect();
    if count % 2 == 1 {
        ring.push(None);
    }
    let size = ring.len();
    let mut rounds = Vec::with_capacity(size - 1);
    for _ in 0..size - 1 {
        let mut pairs = Vec::new();
        for i in 0..size / 2 {
            if let (Some(a), Some(b)) = (ring[i], ring[size - 1 - i]) {
                pairs.push((a.min(b), a.max(b)));
            }
        }
        rounds.push(pairs);
        // Le premier reste fixe, les autres tournent.
        let last = ring.remove(size - 1);
        ring.insert(1, last);
    }
    rounds
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn counts(plan: &[PlannedMatch]) -> (usize, usize) {
        (
            plan.iter()
                .filter(|m| m.bracket != Some(BracketKind::Losers))
                .count(),
            plan.iter()
                .filter(|m| m.bracket == Some(BracketKind::Losers))
                .count(),
        )
    }

    #[test]
    fn seeds_meet_as_late_as_possible() {
        assert_eq!(seed_order(8), vec![1, 8, 4, 5, 2, 7, 3, 6]);
    }

    #[test]
    fn single_elimination_of_a_power_of_two_has_no_bye() {
        let plan = single_elimination(8);
        assert_eq!(plan.len(), 7);
        assert_eq!(plan.iter().filter(|m| m.round == 1).count(), 4);
        assert_eq!(plan[0].seeds, [Some(0), Some(7)]);
        assert!(plan.last().is_some_and(|m| m.winner_to.is_none()));
    }

    #[test]
    fn single_elimination_gives_byes_to_the_best_seeds() {
        for count in 2..=40 {
            let plan = single_elimination(count);
            assert_eq!(
                plan.len(),
                count - 1,
                "{count} participants : {count}-1 matchs"
            );
            // Chaque tête de série est placée exactement une fois.
            let placed: Vec<usize> = plan.iter().flat_map(|m| m.seeds).flatten().collect();
            let distinct: HashSet<usize> = placed.iter().copied().collect();
            assert_eq!(placed.len(), distinct.len());
            assert_eq!(distinct, (0..count).collect::<HashSet<_>>());
            // Chaque match est complet : deux participants ou feeders.
            for (i, m) in plan.iter().enumerate() {
                let fed = plan
                    .iter()
                    .filter(|o| o.winner_to.is_some_and(|(t, _)| t == i))
                    .count();
                assert_eq!(
                    m.seeds.iter().flatten().count() + fed,
                    2,
                    "match {i} de {count}"
                );
            }
        }
        // 5 participants : les têtes 1 à 3 passent directement au deuxième tour.
        let plan = single_elimination(5);
        assert_eq!(plan.iter().filter(|m| m.round == 1).count(), 1);
        assert_eq!(plan[0].seeds, [Some(3), Some(4)]);
    }

    #[test]
    fn single_elimination_needs_two_participants() {
        assert!(single_elimination(1).is_empty());
        assert!(single_elimination(0).is_empty());
    }

    #[test]
    fn double_elimination_of_eight_has_the_expected_shape() {
        let plan = double_elimination(8);
        let winners = plan
            .iter()
            .filter(|m| m.bracket == Some(BracketKind::Winners))
            .count();
        let losers = plan
            .iter()
            .filter(|m| m.bracket == Some(BracketKind::Losers))
            .count();
        let finals = plan
            .iter()
            .filter(|m| m.bracket == Some(BracketKind::GrandFinal))
            .count();
        assert_eq!((winners, losers, finals), (7, 6, 2));
        // Chaque perdant du tableau des vainqueurs descend dans le tableau des perdants.
        for m in plan
            .iter()
            .filter(|m| m.bracket == Some(BracketKind::Winners))
        {
            assert!(
                m.loser_to.is_some(),
                "tout match gagnant a une destination pour le perdant"
            );
        }
        // Chaque match du tableau des perdants mène quelque part.
        for m in plan
            .iter()
            .filter(|m| m.bracket == Some(BracketKind::Losers))
        {
            assert!(m.winner_to.is_some());
            assert!(m.loser_to.is_none());
        }
    }

    #[test]
    fn double_elimination_handles_every_size() {
        for count in 2..=40 {
            let plan = double_elimination(count);
            let placed: Vec<usize> = plan.iter().flat_map(|m| m.seeds).flatten().collect();
            assert_eq!(placed.len(), placed.iter().collect::<HashSet<_>>().len());
            // Un participant gagne chaque match avancé : chaque match non terminal a un suivant.
            let terminals = plan.iter().filter(|m| m.winner_to.is_none()).count();
            assert_eq!(terminals, 1, "{count} participants : un seul match final");
            // Le remplissage est cohérent : deux entrants par match (hors reset).
            for (i, m) in plan.iter().enumerate() {
                if m.bracket == Some(BracketKind::GrandFinal) && m.round == 2 {
                    continue;
                }
                let fed = plan
                    .iter()
                    .map(|o| {
                        usize::from(o.winner_to.is_some_and(|(t, _)| t == i))
                            + usize::from(o.loser_to.is_some_and(|(t, _)| t == i))
                    })
                    .sum::<usize>();
                assert_eq!(
                    m.seeds.iter().flatten().count() + fed,
                    2,
                    "match {i} de {count}"
                );
            }
        }
    }

    #[test]
    fn double_elimination_with_three_participants_is_minimal() {
        let plan = double_elimination(3);
        let (upper, lower) = counts(&plan);
        assert_eq!(upper, 4); // 2 matchs des vainqueurs + finale + reset
        assert_eq!(lower, 1);
    }

    #[test]
    fn the_grand_final_feeds_the_reset() {
        let plan = double_elimination(4);
        let gf = plan
            .iter()
            .position(|m| m.bracket == Some(BracketKind::GrandFinal) && m.round == 1)
            .unwrap();
        let reset = plan
            .iter()
            .position(|m| m.bracket == Some(BracketKind::GrandFinal) && m.round == 2)
            .unwrap();
        assert_eq!(plan[gf].winner_to, Some((reset, 0)));
        assert_eq!(plan[gf].loser_to, Some((reset, 1)));
        assert!(grand_final_ends_tournament(0));
        assert!(!grand_final_ends_tournament(1));
    }

    #[test]
    fn round_robin_pairs_everyone_once() {
        for count in 2..=12 {
            let rounds = round_robin(count);
            let mut seen = HashSet::new();
            for round in &rounds {
                let mut in_round = HashSet::new();
                for (a, b) in round {
                    assert!(seen.insert((*a, *b)), "doublon {a}-{b} pour {count}");
                    assert!(in_round.insert(*a) && in_round.insert(*b), "joue deux fois");
                }
            }
            assert_eq!(seen.len(), count * (count - 1) / 2);
            let expected = if count % 2 == 0 { count - 1 } else { count };
            assert_eq!(rounds.len(), expected);
        }
    }
}
