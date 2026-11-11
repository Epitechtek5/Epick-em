//! Modèle canonique, neutre vis-à-vis des fournisseurs (ADR-003).
//!
//! Chaque connecteur traduit sa source dans ces types ; le cœur ne connaît qu'eux. Toute donnée
//! garde l'identifiant stable du fournisseur (`external_id`) et, quand il existe, un lien vers
//! l'original. Une donnée que la source ne fournit pas reste `None` ou vide : rien n'est inventé.

use serde::{Deserialize, Serialize};

/// Données qu'une source sait fournir. Au niveau du connecteur, c'est ce que la source peut
/// fournir ; au niveau d'un tournoi importé, ce qu'elle a effectivement fourni.
/// Une capacité absente vaut `false` (ligne fraîchement enregistrée, ancienne version).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Capabilities {
    pub search: bool,
    pub url_resolution: bool,
    pub phases: bool,
    pub groups: bool,
    pub matches: bool,
    pub games: bool,
    pub characters: bool,
    pub stages: bool,
    pub seeds: bool,
    pub standings: bool,
    /// Synchronisation incrémentale (seuls les changements depuis un curseur).
    pub incremental_sync: bool,
}

impl Capabilities {
    /// Capacités effectivement présentes dans `tournament`.
    pub fn observed(tournament: &ExternalTournament, provider: Capabilities) -> Self {
        let events = &tournament.events;
        let matches = || events.iter().flat_map(|e| &e.matches);
        let games = || matches().flat_map(|m| &m.games);
        Capabilities {
            search: provider.search,
            url_resolution: provider.url_resolution,
            incremental_sync: provider.incremental_sync,
            phases: events.iter().any(|e| !e.phases.is_empty()),
            groups: events
                .iter()
                .flat_map(|e| &e.phases)
                .any(|p| !p.groups.is_empty()),
            matches: matches().next().is_some(),
            games: games().next().is_some(),
            characters: games().any(|g| g.selections.iter().any(|s| s.character.is_some())),
            stages: games().any(|g| g.stage.is_some()),
            seeds: events
                .iter()
                .flat_map(|e| &e.entrants)
                .any(|e| e.seed.is_some()),
            standings: events.iter().any(|e| !e.standings.is_empty()),
        }
    }
}

/// Référence vers un tournoi d'une source, obtenue par recherche ou par URL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExternalTournamentRef {
    /// Identifiant du connecteur (`"startgg"`).
    pub provider: String,
    /// Identifiant stable du tournoi chez le fournisseur.
    pub external_id: String,
    /// Identifiant lisible (slug), s'il existe.
    pub slug: Option<String>,
    pub name: String,
    /// URL canonique de l'original.
    pub url: Option<String>,
    /// Début, en secondes Unix.
    pub starts_at: Option<i64>,
    pub ends_at: Option<i64>,
}

/// Épreuve d'un tournoi (start.gg : « event », ex. « Ultimate Singles »).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExternalEventRef {
    pub external_id: String,
    pub name: String,
    pub game: Option<String>,
    pub url: Option<String>,
    pub starts_at: Option<i64>,
    pub state: CompetitionState,
    pub entrant_count: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompetitionState {
    #[default]
    Created,
    Active,
    Completed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExternalTournament {
    #[serde(flatten)]
    pub reference: ExternalTournamentRef,
    pub state: CompetitionState,
    /// Épreuves sélectionnées à l'import.
    pub events: Vec<ExternalEvent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExternalEvent {
    #[serde(flatten)]
    pub reference: ExternalEventRef,
    pub phases: Vec<ExternalPhase>,
    pub entrants: Vec<ExternalEntrant>,
    pub matches: Vec<ExternalMatch>,
    pub standings: Vec<ExternalStanding>,
}

/// Format d'une phase ou d'un groupe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BracketFormat {
    SingleElimination,
    DoubleElimination,
    RoundRobin,
    Swiss,
    /// Format que le modèle ne représente pas (ex. ligue personnalisée).
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExternalPhase {
    pub external_id: String,
    pub name: String,
    /// Ordre dans l'épreuve (à partir de 1), si la source le donne.
    pub order: Option<u32>,
    pub format: Option<BracketFormat>,
    pub state: CompetitionState,
    pub groups: Vec<ExternalGroup>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExternalGroup {
    pub external_id: String,
    /// Identifiant lisible du groupe (« A1 », « 1 »…).
    pub label: Option<String>,
    pub format: Option<BracketFormat>,
    pub state: CompetitionState,
    pub url: Option<String>,
}

/// Inscrit d'une épreuve : un joueur, ou une équipe (start.gg : « entrant »).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExternalEntrant {
    pub external_id: String,
    pub name: String,
    pub seed: Option<u32>,
    pub players: Vec<ExternalPlayer>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExternalPlayer {
    pub external_id: String,
    pub gamer_tag: String,
    pub prefix: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchState {
    #[default]
    Pending,
    InProgress,
    Completed,
}

/// Match (start.gg : « set »).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExternalMatch {
    pub external_id: String,
    pub phase_id: Option<String>,
    pub group_id: Option<String>,
    /// Tour : positif côté gagnants, négatif côté perdants (convention start.gg).
    pub round: Option<i32>,
    pub round_label: Option<String>,
    pub state: MatchState,
    pub slots: Vec<ExternalSlot>,
    pub winner_entrant_id: Option<String>,
    /// Forfait ou disqualification déclaré par la source.
    pub forfeit: bool,
    pub games: Vec<ExternalGame>,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    /// Dernière modification chez la source (curseur de synchronisation).
    pub updated_at: Option<i64>,
    pub url: Option<String>,
}

impl ExternalMatch {
    /// Ce qui définit le résultat : un changement ici est une correction de résultat.
    pub fn outcome(&self) -> (MatchState, Option<&str>, Vec<Option<i32>>, bool) {
        (
            self.state,
            self.winner_entrant_id.as_deref(),
            self.slots.iter().map(|s| s.score).collect(),
            self.forfeit,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExternalSlot {
    /// `None` tant que la place n'est pas attribuée (vainqueur d'un match précédent).
    pub entrant_id: Option<String>,
    pub score: Option<i32>,
}

/// Manche d'un match.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExternalGame {
    pub external_id: Option<String>,
    pub order: u32,
    pub winner_entrant_id: Option<String>,
    pub stage: Option<String>,
    pub selections: Vec<ExternalSelection>,
}

/// Personnage choisi par un inscrit pour une manche.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExternalSelection {
    pub entrant_id: String,
    pub character: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExternalStanding {
    pub entrant_id: String,
    pub placement: u32,
}

/// Position de synchronisation : dernière modification vue chez la source, en secondes Unix.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncCursor {
    pub updated_after: Option<i64>,
}

/// Résultat d'une synchronisation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ExternalDelta {
    /// Instantané complet (repli quand l'incrémental n'est pas possible).
    Full { tournament: ExternalTournament },
    /// Seulement les matchs modifiés depuis le curseur, et l'état courant des épreuves.
    Partial {
        state: CompetitionState,
        matches: Vec<(String, ExternalMatch)>,
        standings: Vec<(String, Vec<ExternalStanding>)>,
    },
}
