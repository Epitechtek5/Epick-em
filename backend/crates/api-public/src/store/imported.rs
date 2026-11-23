//! Tournoi importé d'une source externe (start.gg…) : son modèle local vit dans Redis et
//! jamais en base.
//!
//! PostgreSQL ne garde que la ligne du tournoi et son lien vers la source. À chaque
//! synchronisation, l'instantané de la source ([`Projection`]) est traduit en inscrits, étapes,
//! groupes, matchs et résultats ([`ImportedTournament::build`]) puis écrit dans Redis
//! ([`Imports::save`]). Les lectures des stores ([`super::PgStore`], [`super::MemoryStore`])
//! servent ce modèle pour un tournoi importé, sans requête en base.
//!
//! Les identifiants locaux sont dérivés de l'identifiant chez la source (UUID v5 dans l'espace
//! du tournoi) : ils restent stables d'une synchronisation à l'autre, sans table de
//! correspondance. Si Redis perd le modèle (base vidée, éviction), la synchronisation suivante
//! le réécrit à l'identique.

use super::teams::now_rfc3339;
use super::{
    Match, MatchParticipant, MatchStatus, Projection, Step, StepGroup, StepParticipant, Tournament,
    TournamentParticipant, TournamentStatus,
};
use infra::{Cache, Ttl};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

/// Réécrit à chaque synchronisation (au moins toutes les 6 h pour un tournoi terminé) : cette
/// durée ne sert qu'à oublier le modèle d'un tournoi qui n'est plus synchronisé.
const TTL: Ttl = Ttl::from_hours(24 * 30);

/// Modèle local d'un tournoi importé, rangé dans Redis sous `import:tournament:{id}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImportedTournament {
    pub tournament_id: Uuid,
    pub game_id: Uuid,
    pub status: TournamentStatus,
    /// Dans l'ordre d'affichage (tête de série, puis identifiant chez la source).
    pub participants: Vec<TournamentParticipant>,
    /// Par position.
    pub steps: Vec<Step>,
    /// Par étape, puis rang.
    pub groups: Vec<StepGroup>,
    pub step_participants: Vec<StepParticipant>,
    /// Par groupe, puis tour, puis ordre chez la source.
    pub matches: Vec<Match>,
    pub match_participants: Vec<MatchParticipant>,
}

/// Résumé lu par les listes de tournois (`import:summary:{id}`) : statut et taille, sans
/// charger tout le modèle.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ImportedSummary {
    pub status: TournamentStatus,
    pub participants: i32,
}

impl ImportedSummary {
    /// Applique le résumé à la ligne du tournoi lue en base.
    pub fn apply(self, tournament: &mut Tournament) {
        tournament.status = self.status;
        tournament.max_participants = tournament.max_participants.max(self.participants).max(1);
    }
}

fn local_id(tournament_id: Uuid, kind: &str, key: &str) -> Uuid {
    Uuid::new_v5(&tournament_id, format!("{kind}:{key}").as_bytes())
}

impl ImportedTournament {
    /// Traduit `projection` en modèle local. `previous` (le modèle de la synchronisation
    /// précédente) garde les dates de création et d'inscription.
    pub fn build(
        tournament_id: Uuid,
        game_id: Uuid,
        previous: Option<&ImportedTournament>,
        projection: Projection,
    ) -> Self {
        let now = now_rfc3339();
        let registered: HashMap<Uuid, &str> = previous
            .map(|p| {
                p.participants
                    .iter()
                    .map(|q| (q.id, q.registered_at.as_str()))
                    .collect()
            })
            .unwrap_or_default();
        let created: HashMap<Uuid, &str> = previous
            .map(|p| {
                p.steps
                    .iter()
                    .map(|s| (s.id, s.created_at.as_str()))
                    .chain(p.matches.iter().map(|m| (m.id, m.created_at.as_str())))
                    .collect()
            })
            .unwrap_or_default();
        let since = |id: Uuid, map: &HashMap<Uuid, &str>| {
            map.get(&id)
                .map_or_else(|| now.clone(), |s| (*s).to_string())
        };

        let mut participant_ids: HashMap<String, Uuid> = HashMap::new();
        let mut participants = Vec::new();
        for p in projection.participants {
            let id = local_id(tournament_id, "participant", &p.external_id);
            if participant_ids.insert(p.external_id.clone(), id).is_some() {
                continue;
            }
            participants.push(TournamentParticipant {
                id,
                tournament_id,
                user_id: None,
                tournament_team_id: None,
                status: p.status,
                registered_at: since(id, &registered),
                external_id: Some(p.external_id),
                display_name: Some(p.display_name),
            });
        }

        let mut model = ImportedTournament {
            tournament_id,
            game_id,
            status: projection.status,
            participants,
            steps: Vec::new(),
            groups: Vec::new(),
            step_participants: Vec::new(),
            matches: Vec::new(),
            match_participants: Vec::new(),
        };
        for step in projection.steps {
            let step_id = local_id(tournament_id, "step", &step.external_id);
            let d = step.definition;
            model.steps.push(Step {
                id: step_id,
                tournament_id,
                position: d.position,
                format: d.format,
                match_type: d.match_type,
                group_count: d.group_count,
                group_size: d.group_size,
                matches_per_group: d.matches_per_group,
                advance_per_group: d.advance_per_group,
                tiebreak: d.tiebreak,
                status: step.status,
                created_at: since(step_id, &created),
                updated_at: now.clone(),
            });
            for (index, group) in step.groups.into_iter().enumerate() {
                let group_key = format!("{}:{}", step.external_id, group.external_id);
                let group_id = local_id(tournament_id, "group", &group_key);
                model.groups.push(StepGroup {
                    id: group_id,
                    step_id,
                    index: i32::try_from(index + 1).unwrap_or(i32::MAX),
                });
                for member in group.members {
                    let Some(&participant_id) = participant_ids.get(&member.participant) else {
                        continue;
                    };
                    // Un inscrit n'appartient qu'à un groupe par étape.
                    if model
                        .step_participants
                        .iter()
                        .any(|p| p.step_id == step_id && p.participant_id == participant_id)
                    {
                        continue;
                    }
                    model.step_participants.push(StepParticipant {
                        step_id,
                        participant_id,
                        group_id,
                        points: member.points,
                        final_rank: member.final_rank,
                        status: member.status,
                    });
                }
                let mut matches = Vec::new();
                for projected in group.matches {
                    let match_key = format!("{}:{}", step.external_id, projected.external_id);
                    let match_id = local_id(tournament_id, "match", &match_key);
                    if model.matches.iter().any(|m| m.id == match_id) {
                        continue;
                    }
                    for entry in projected.entries {
                        if let Some(&participant_id) = participant_ids.get(&entry.participant) {
                            model.match_participants.push(MatchParticipant {
                                match_id,
                                participant_id,
                                stats: entry.stats,
                                points: entry.points,
                                rank: entry.rank,
                                result: entry.result,
                            });
                        }
                    }
                    matches.push(Match {
                        id: match_id,
                        game_id,
                        step_id,
                        group_id: Some(group_id),
                        round: projected.round,
                        bracket: projected.bracket,
                        next_match_id: None,
                        scheduled_at: None,
                        started_at: projected.started_at,
                        ended_at: projected.ended_at,
                        status: projected.status,
                        created_at: since(match_id, &created),
                        updated_at: now.clone(),
                    });
                }
                // Tri stable : à tour égal, l'ordre de la source est conservé.
                matches.sort_by_key(|m| m.round.unwrap_or(0));
                model.matches.extend(matches);
            }
        }
        model.steps.sort_by_key(|s| s.position);
        if let Some(previous) = previous {
            model.keep_unchanged_timestamps(previous);
        }
        model
    }

    /// Une étape ou un match identique à la synchronisation précédente (participants et
    /// résultats compris) garde son `updated_at` : le modèle ne change que si la source a changé.
    fn keep_unchanged_timestamps(&mut self, previous: &ImportedTournament) {
        let match_rows = |model: &ImportedTournament, id: Uuid| -> Vec<MatchParticipant> {
            model
                .match_participants
                .iter()
                .filter(|p| p.match_id == id)
                .cloned()
                .collect()
        };
        let step_rows = |model: &ImportedTournament, id: Uuid| {
            let participants: Vec<StepParticipant> = model
                .step_participants
                .iter()
                .filter(|p| p.step_id == id)
                .cloned()
                .collect();
            let groups: Vec<StepGroup> = model
                .groups
                .iter()
                .filter(|g| g.step_id == id)
                .cloned()
                .collect();
            (participants, groups)
        };
        let kept_matches: Vec<(usize, String)> = self
            .matches
            .iter()
            .enumerate()
            .filter_map(|(index, current)| {
                let old = previous.matches.iter().find(|o| o.id == current.id)?;
                let same = Match {
                    updated_at: old.updated_at.clone(),
                    ..current.clone()
                } == *old
                    && match_rows(self, current.id) == match_rows(previous, current.id);
                same.then(|| (index, old.updated_at.clone()))
            })
            .collect();
        for (index, updated_at) in kept_matches {
            self.matches[index].updated_at = updated_at;
        }
        let kept_steps: Vec<(usize, String)> = self
            .steps
            .iter()
            .enumerate()
            .filter_map(|(index, current)| {
                let old = previous.steps.iter().find(|o| o.id == current.id)?;
                let same = Step {
                    updated_at: old.updated_at.clone(),
                    ..current.clone()
                } == *old
                    && step_rows(self, current.id) == step_rows(previous, current.id);
                same.then(|| (index, old.updated_at.clone()))
            })
            .collect();
        for (index, updated_at) in kept_steps {
            self.steps[index].updated_at = updated_at;
        }
    }

    pub fn summary(&self) -> ImportedSummary {
        ImportedSummary {
            status: self.status,
            participants: i32::try_from(self.participants.len()).unwrap_or(i32::MAX),
        }
    }

    /// Identifiants des éléments qui renvoient au tournoi (inscrits, étapes, matchs).
    fn element_ids(&self) -> impl Iterator<Item = Uuid> + '_ {
        self.participants
            .iter()
            .map(|p| p.id)
            .chain(self.steps.iter().map(|s| s.id))
            .chain(self.matches.iter().map(|m| m.id))
    }

    pub fn participants(&self, limit: i64, offset: i64) -> Vec<TournamentParticipant> {
        self.participants
            .iter()
            .skip(usize::try_from(offset).unwrap_or(0))
            .take(usize::try_from(limit).unwrap_or(0))
            .cloned()
            .collect()
    }

    pub fn participant(&self, id: Uuid) -> Option<TournamentParticipant> {
        self.participants.iter().find(|p| p.id == id).cloned()
    }

    /// Total des points d'étape par inscrit.
    pub fn points(&self) -> HashMap<Uuid, f64> {
        let mut points = HashMap::new();
        for p in &self.step_participants {
            *points.entry(p.participant_id).or_insert(0.0) += p.points;
        }
        points
    }

    pub fn step(&self, id: Uuid) -> Option<Step> {
        self.steps.iter().find(|s| s.id == id).cloned()
    }

    pub fn groups(&self, step_id: Uuid) -> Vec<StepGroup> {
        self.groups
            .iter()
            .filter(|g| g.step_id == step_id)
            .cloned()
            .collect()
    }

    pub fn step_participants(&self, step_id: Uuid) -> Vec<StepParticipant> {
        let index_of = |group_id: Uuid| {
            self.groups
                .iter()
                .find(|g| g.id == group_id)
                .map_or(0, |g| g.index)
        };
        let mut members: Vec<StepParticipant> = self
            .step_participants
            .iter()
            .filter(|p| p.step_id == step_id)
            .cloned()
            .collect();
        members.sort_by_key(|p| index_of(p.group_id));
        members
    }

    pub fn matches(
        &self,
        step_id: Uuid,
        group_id: Option<Uuid>,
        status: Option<MatchStatus>,
    ) -> Vec<Match> {
        self.matches
            .iter()
            .filter(|m| m.step_id == step_id)
            .filter(|m| group_id.is_none_or(|id| m.group_id == Some(id)))
            .filter(|m| status.is_none_or(|status| m.status == status))
            .cloned()
            .collect()
    }

    pub fn find_match(&self, id: Uuid) -> Option<Match> {
        self.matches.iter().find(|m| m.id == id).cloned()
    }

    pub fn match_participants(&self, step_id: Uuid) -> Vec<MatchParticipant> {
        let mut participants: Vec<MatchParticipant> = self
            .match_participants
            .iter()
            .filter(|p| {
                self.matches
                    .iter()
                    .any(|m| m.id == p.match_id && m.step_id == step_id)
            })
            .cloned()
            .collect();
        participants.sort_by_key(|p| (p.match_id, p.participant_id));
        participants
    }
}

/// Modèles des tournois importés, dans le cache (Redis en production).
///
/// Une lecture qui échoue (Redis indisponible, valeur illisible) est journalisée et vaut une
/// absence ; une écriture qui échoue fait échouer la synchronisation, rejouée ensuite.
#[derive(Clone)]
pub struct Imports {
    cache: Arc<dyn Cache>,
}

impl Imports {
    pub fn new(cache: Arc<dyn Cache>) -> Self {
        Imports { cache }
    }

    fn tournament_key(id: Uuid) -> String {
        format!("import:tournament:{id}")
    }

    fn summary_key(id: Uuid) -> String {
        format!("import:summary:{id}")
    }

    /// Clé qui mène d'un inscrit, d'une étape ou d'un match à son tournoi.
    fn owner_key(id: Uuid) -> String {
        format!("import:owner:{id}")
    }

    async fn read<T: serde::de::DeserializeOwned>(&self, key: &str) -> Option<T> {
        match self.cache.get(key).await {
            Ok(Some(bytes)) => serde_json::from_slice(&bytes)
                .inspect_err(|err| eprintln!("import : valeur illisible sous {key} : {err}"))
                .ok(),
            Ok(None) => None,
            Err(err) => {
                eprintln!("import : lecture de {key} impossible : {err}");
                None
            }
        }
    }

    async fn write<T: Serialize>(&self, key: &str, value: &T) -> Result<(), String> {
        let bytes = serde_json::to_vec(value).map_err(|err| err.to_string())?;
        self.cache
            .set(key, bytes, TTL)
            .await
            .map_err(|err| format!("écriture de {key} : {err}"))
    }

    pub fn cache(&self) -> Arc<dyn Cache> {
        self.cache.clone()
    }

    pub fn prepare(
        model: &ImportedTournament,
    ) -> Result<Vec<connectors::sync::ProjectionEntry>, String> {
        let id = model.tournament_id;
        let mut entries = Vec::new();
        let mut add = |key, value: Vec<u8>| {
            entries.push(connectors::sync::ProjectionEntry {
                key,
                value,
                ttl_secs: TTL.as_secs(),
            })
        };
        for element in model.element_ids() {
            add(
                Self::owner_key(element),
                serde_json::to_vec(&id).map_err(|e| e.to_string())?,
            );
        }
        add(
            Self::tournament_key(id),
            serde_json::to_vec(model).map_err(|e| e.to_string())?,
        );
        add(
            Self::summary_key(id),
            serde_json::to_vec(&model.summary()).map_err(|e| e.to_string())?,
        );
        Ok(entries)
    }

    /// Modèle du tournoi, s'il est importé.
    pub async fn tournament(&self, id: Uuid) -> Option<ImportedTournament> {
        self.read(&Self::tournament_key(id)).await
    }

    pub async fn summary(&self, id: Uuid) -> Option<ImportedSummary> {
        self.read(&Self::summary_key(id)).await
    }

    /// Modèle du tournoi importé auquel appartient l'inscrit, l'étape ou le match `id`.
    pub async fn owner(&self, id: Uuid) -> Option<ImportedTournament> {
        let tournament_id: Uuid = self.read(&Self::owner_key(id)).await?;
        self.tournament(tournament_id).await
    }

    /// Écrit le modèle, son résumé et le renvoi de chaque élément vers le tournoi. Un renvoi
    /// laissé par un élément disparu de la source mène à un modèle qui ne le contient plus : il
    /// est ignoré, puis expire.
    pub async fn save(&self, model: &ImportedTournament) -> Result<(), String> {
        let id = model.tournament_id;
        for element in model.element_ids() {
            self.write(&Self::owner_key(element), &id).await?;
        }
        self.write(&Self::tournament_key(id), model).await?;
        self.write(&Self::summary_key(id), &model.summary()).await
    }

    /// Oublie le modèle du tournoi (tournoi supprimé).
    pub async fn forget(&self, id: Uuid) {
        let mut keys = vec![Self::tournament_key(id), Self::summary_key(id)];
        if let Some(model) = self.tournament(id).await {
            keys.extend(model.element_ids().map(Self::owner_key));
        }
        let keys: Vec<&str> = keys.iter().map(String::as_str).collect();
        if let Err(err) = self.cache.delete(&keys).await {
            eprintln!("import : oubli du tournoi {id} impossible : {err}");
        }
    }
}

impl Default for Imports {
    /// Cache en mémoire (tests, store en mémoire).
    fn default() -> Self {
        Imports::new(Arc::new(infra::MemoryCache::new()))
    }
}
