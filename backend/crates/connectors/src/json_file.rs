//! Connecteur « fichiers JSON » : le second connecteur du guide (`docs/connecteurs.md`).
//!
//! Chaque tournoi est un fichier `<slug>.json` d'un répertoire, au format du modèle canonique
//! ([`ExternalTournament`]). Il sert de tutoriel (moins de 150 lignes, sans toucher au cœur),
//! de source de démonstration hors ligne et de modèle pour une source sans API riche : il ne
//! sait pas faire de synchronisation incrémentale et garde donc l'implémentation par défaut de
//! [`TournamentConnector::fetch_updates`] (instantané complet).
//!
//! URL reconnues : `jsonfile://<slug>`. Le slug est validé : impossible de sortir du
//! répertoire.

use crate::connector::{ConnectorError, TournamentConnector};
use crate::model::{Capabilities, ExternalEventRef, ExternalTournament, ExternalTournamentRef};
use crate::startgg::url::valid_slug;
use async_trait::async_trait;
use std::path::PathBuf;

pub const PROVIDER: &str = "jsonfile";
const SCHEME: &str = "jsonfile://";

pub struct JsonFileConnector {
    root: PathBuf,
}

impl JsonFileConnector {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        JsonFileConnector { root: root.into() }
    }

    /// Lit et valide `<slug>.json`.
    async fn load(&self, slug: &str) -> Result<ExternalTournament, ConnectorError> {
        if !valid_slug(slug) {
            return Err(ConnectorError::InvalidUrl("slug invalide".into()));
        }
        let path = self.root.join(format!("{slug}.json"));
        let bytes = match tokio::fs::read(&path).await {
            Ok(bytes) => bytes,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Err(ConnectorError::NotFound);
            }
            Err(err) => return Err(ConnectorError::Unavailable(err.to_string())),
        };
        let mut tournament: ExternalTournament = serde_json::from_slice(&bytes)
            .map_err(|err| ConnectorError::Unavailable(format!("{slug}.json : {err}")))?;
        // L'identité vient du fichier, la source et le slug du connecteur.
        tournament.reference.provider = PROVIDER.into();
        tournament.reference.slug = Some(slug.into());
        tournament.reference.url = Some(format!("{SCHEME}{slug}"));
        Ok(tournament)
    }
}

#[async_trait]
impl TournamentConnector for JsonFileConnector {
    fn id(&self) -> &'static str {
        PROVIDER
    }

    fn display_name(&self) -> &'static str {
        "Fichiers JSON"
    }

    fn capabilities(&self) -> Capabilities {
        // Tout ce que le format canonique peut porter ; un fichier donné peut en fournir moins
        // (voir `Capabilities::observed`).
        Capabilities {
            search: true,
            url_resolution: true,
            phases: true,
            groups: true,
            matches: true,
            games: true,
            characters: true,
            stages: true,
            seeds: true,
            standings: true,
            incremental_sync: false,
        }
    }

    async fn search(&self, query: &str) -> Result<Vec<ExternalTournamentRef>, ConnectorError> {
        let query = query.trim().to_lowercase();
        let mut entries = tokio::fs::read_dir(&self.root)
            .await
            .map_err(|err| ConnectorError::Unavailable(err.to_string()))?;
        let mut found = Vec::new();
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(slug) = name.strip_suffix(".json") else {
                continue;
            };
            if let Ok(tournament) = self.load(slug).await
                && tournament.reference.name.to_lowercase().contains(&query)
            {
                found.push(tournament.reference);
            }
        }
        found.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(found)
    }

    async fn resolve_url(&self, url: &str) -> Result<ExternalTournamentRef, ConnectorError> {
        let slug = url
            .trim()
            .strip_prefix(SCHEME)
            .ok_or_else(|| ConnectorError::InvalidUrl("pas une URL jsonfile://".into()))?;
        Ok(self.load(slug).await?.reference)
    }

    async fn list_events(
        &self,
        tournament: &ExternalTournamentRef,
    ) -> Result<Vec<ExternalEventRef>, ConnectorError> {
        let slug = tournament.slug.as_deref().unwrap_or_default();
        Ok(self
            .load(slug)
            .await?
            .events
            .into_iter()
            .map(|event| event.reference)
            .collect())
    }

    async fn fetch(
        &self,
        tournament: &ExternalTournamentRef,
        event_ids: &[String],
    ) -> Result<ExternalTournament, ConnectorError> {
        let slug = tournament.slug.as_deref().unwrap_or_default();
        let mut loaded = self.load(slug).await?;
        if event_ids
            .iter()
            .any(|id| !loaded.events.iter().any(|e| &e.reference.external_id == id))
        {
            return Err(ConnectorError::NotFound);
        }
        loaded
            .events
            .retain(|event| event_ids.contains(&event.reference.external_id));
        Ok(loaded)
    }
}
