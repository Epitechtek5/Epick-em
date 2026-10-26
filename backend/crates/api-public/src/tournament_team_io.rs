//! Équipes d'un tournoi (`tournament_teams` et `tournament_team_member`), sous-niveau du fichier
//! des tournois (voir [`crate::tournament_io`]).
//!
//! Le niveau des tournois les traite comme des valeurs opaques ; ce module est le seul à connaître
//! leur structure : un tableau de
//! `{ "name", "tag", "picture_url", "owner", "origin", "members": [{ "username", "role" }] }`.
//! Les comptes sont désignés par leur nom d'utilisateur et l'équipe globale copiée (`origin`) par
//! son nom, dans le jeu du tournoi. Importer remplace toutes les équipes du tournoi.

use crate::store::{AuthStore, StoreError, TeamRole, TournamentTeamInput};
use crate::teams::validate;
use crate::tournament_io::TournamentChild;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::hash_map::Entry;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use utoipa::ToSchema;
use uuid::Uuid;

/// Nombre maximal de problèmes détaillés dans un message d'erreur.
const MAX_REPORTED_ERRORS: usize = 10;

/// Équipes de tournoi lues et écrites dans la base, pour le fichier des tournois.
pub struct StoreTournamentTeams(pub Arc<dyn AuthStore>);

/// Équipe de tournoi telle qu'elle s'embarque dans le fichier d'un tournoi.
#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct TournamentTeamItem {
    name: String,
    #[serde(default)]
    tag: Option<String>,
    #[serde(default)]
    picture_url: Option<String>,
    /// Nom d'utilisateur du propriétaire.
    owner: String,
    /// Nom de l'équipe globale copiée, dans le jeu du tournoi ; absent si créée de zéro.
    #[serde(default)]
    origin: Option<String>,
    members: Vec<TournamentTeamMemberItem>,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct TournamentTeamMemberItem {
    username: String,
    role: TeamRole,
}

fn parse(items: &[Value]) -> Result<Vec<TournamentTeamItem>, String> {
    items
        .iter()
        .enumerate()
        .map(|(index, value)| {
            serde_json::from_value(value.clone())
                .map_err(|e| format!("équipe {} invalide ({e}).", index + 1))
        })
        .collect()
}

fn other(detail: impl std::fmt::Display) -> StoreError {
    StoreError::Other(detail.to_string())
}

impl StoreTournamentTeams {
    async fn username(&self, id: Uuid) -> Result<String, StoreError> {
        Ok(self
            .0
            .find_profile(id)
            .await?
            .ok_or_else(|| other(format!("compte {id} introuvable")))?
            .username)
    }

    /// Équipes globales du jeu, par nom en minuscules.
    async fn global_teams(&self, game_id: Uuid) -> Result<HashMap<String, Uuid>, StoreError> {
        Ok(self
            .0
            .list_teams(Some(game_id), i64::MAX, 0)
            .await?
            .into_iter()
            .map(|team| (team.name.to_lowercase(), team.id))
            .collect())
    }

    async fn user_id(&self, username: &str) -> Result<Option<Uuid>, StoreError> {
        Ok(self
            .0
            .find_user_by_username(username.trim())
            .await?
            .map(|user| user.id))
    }
}

#[async_trait]
impl TournamentChild for StoreTournamentTeams {
    async fn export(&self, tournament_id: Uuid) -> Result<Vec<(Uuid, Value)>, StoreError> {
        let mut exported = Vec::new();
        for team in self
            .0
            .list_tournament_teams(tournament_id, i64::MAX, 0)
            .await?
        {
            let mut members = Vec::new();
            for member in self
                .0
                .list_tournament_team_members(team.id)
                .await?
                .unwrap_or_default()
            {
                members.push(TournamentTeamMemberItem {
                    username: self.username(member.user_id).await?,
                    role: member.role,
                });
            }
            members.sort_by(|a, b| a.username.cmp(&b.username));
            let origin = match team.team_id {
                Some(id) => self.0.find_team(id).await?.map(|team| team.name),
                None => None,
            };
            let item = TournamentTeamItem {
                name: team.name,
                tag: team.tag,
                picture_url: team.picture_url,
                owner: self.username(team.owner_id).await?,
                origin,
                members,
            };
            let value = serde_json::to_value(item).map_err(other)?;
            exported.push((team.id, value));
        }
        // Ordre indépendant des identifiants : deux exports du même contenu sont identiques.
        exported.sort_by_cached_key(|(_, value)| value.to_string().to_lowercase());
        Ok(exported)
    }

    async fn validate(&self, game_id: Uuid, items: &[Value]) -> Result<Option<String>, StoreError> {
        let teams = match parse(items) {
            Ok(teams) => teams,
            Err(problem) => return Ok(Some(problem)),
        };
        let globals = self.global_teams(game_id).await?;
        let mut users: HashMap<String, Option<Uuid>> = HashMap::new();
        let mut problems = Vec::new();
        let mut players = HashSet::new();
        let mut origins = HashSet::new();
        for (index, team) in teams.iter().enumerate() {
            let tag = team.tag.as_deref().map(str::trim).filter(|t| !t.is_empty());
            let picture = team
                .picture_url
                .as_deref()
                .map(str::trim)
                .filter(|u| !u.is_empty());
            let mut reasons: Vec<String> = validate(Some(team.name.trim()), tag, picture)
                .into_iter()
                .map(|(field, message)| format!("{field} : {message}"))
                .collect();
            if let Some(origin) = &team.origin {
                let key = origin.trim().to_lowercase();
                if !globals.contains_key(&key) {
                    reasons.push(format!(
                        "origin : équipe globale inconnue pour ce jeu « {origin} »."
                    ));
                } else if !origins.insert(key) {
                    reasons.push(format!(
                        "origin : « {origin} » est copiée plusieurs fois dans ce tournoi."
                    ));
                }
            }
            let mut names = vec![team.owner.as_str()];
            names.extend(team.members.iter().map(|m| m.username.as_str()));
            for name in names {
                let key = name.trim().to_lowercase();
                if let Entry::Vacant(slot) = users.entry(key) {
                    slot.insert(self.user_id(name).await?);
                }
            }
            let known = |name: &str| users.get(&name.trim().to_lowercase()).copied().flatten();
            if known(&team.owner).is_none() {
                reasons.push(format!("owner : compte inconnu « {} ».", team.owner));
            }
            let owners: Vec<&str> = team
                .members
                .iter()
                .filter(|m| m.role == TeamRole::Owner)
                .map(|m| m.username.as_str())
                .collect();
            if owners.len() != 1 || !owners[0].trim().eq_ignore_ascii_case(team.owner.trim()) {
                reasons.push(
                    "members : le propriétaire doit être l'unique membre de rôle `owner`.".into(),
                );
            }
            let mut in_team = HashSet::new();
            for member in &team.members {
                match known(&member.username) {
                    None => {
                        reasons.push(format!("members : compte inconnu « {} ».", member.username))
                    }
                    Some(id) => {
                        if !in_team.insert(id) {
                            reasons.push(format!(
                                "members : « {} » apparaît plusieurs fois.",
                                member.username
                            ));
                        } else if !players.insert(id) {
                            reasons.push(format!(
                                "members : « {} » est déjà dans une autre équipe du tournoi.",
                                member.username
                            ));
                        }
                    }
                }
            }
            if !reasons.is_empty() {
                problems.push(format!("équipe {} : {}", index + 1, reasons.join(" ")));
            }
        }
        problems.truncate(MAX_REPORTED_ERRORS);
        Ok((!problems.is_empty()).then(|| problems.join(" ")))
    }

    async fn import(
        &self,
        tournament_id: Uuid,
        items: Vec<Value>,
    ) -> Result<Vec<Uuid>, StoreError> {
        let teams = parse(&items).map_err(StoreError::Other)?;
        let tournament = self
            .0
            .find_tournament(tournament_id)
            .await?
            .ok_or_else(|| other(format!("tournoi {tournament_id} introuvable")))?;
        let globals = self.global_teams(tournament.game_id).await?;
        // Les équipes sont remplacées : on retire les anciennes avant d'écrire les nouvelles.
        for old in self
            .0
            .list_tournament_teams(tournament_id, i64::MAX, 0)
            .await?
        {
            self.0.delete_tournament_team(old.id).await?;
        }
        let mut ids = Vec::with_capacity(teams.len());
        for team in teams {
            let owner_id = self
                .user_id(&team.owner)
                .await?
                .ok_or_else(|| other(format!("compte {} introuvable", team.owner)))?;
            let mut members = Vec::with_capacity(team.members.len());
            for member in &team.members {
                let user_id = self
                    .user_id(&member.username)
                    .await?
                    .ok_or_else(|| other(format!("compte {} introuvable", member.username)))?;
                members.push((user_id, member.role));
            }
            let created = self
                .0
                .create_tournament_team(TournamentTeamInput {
                    tournament_id,
                    team_id: team
                        .origin
                        .as_ref()
                        .and_then(|origin| globals.get(&origin.trim().to_lowercase()).copied()),
                    name: team.name.trim().to_string(),
                    tag: team
                        .tag
                        .map(|t| t.trim().to_string())
                        .filter(|t| !t.is_empty()),
                    picture_url: team
                        .picture_url
                        .map(|u| u.trim().to_string())
                        .filter(|u| !u.is_empty()),
                    owner_id,
                    members,
                })
                .await?;
            ids.push(created.id);
        }
        Ok(ids)
    }
}
