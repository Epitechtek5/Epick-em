//! Interface commune des sources de tournois (ADR-003).

use crate::model::{
    Capabilities, ExternalDelta, ExternalEventRef, ExternalTournament, ExternalTournamentRef,
    SyncCursor,
};
use async_trait::async_trait;
use std::fmt;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectorError {
    /// URL ou slug refusé (hôte inconnu, forme invalide) : aucune requête n'est faite.
    InvalidUrl(String),
    NotFound,
    /// Opération que la source ne propose pas.
    Unsupported(&'static str),
    /// Limite de la source atteinte ; `retry_after` si elle l'indique.
    RateLimited {
        retry_after: Option<Duration>,
    },
    Timeout,
    /// Source injoignable ou en erreur (5xx, réseau, réponse illisible).
    Unavailable(String),
    /// Identifiants refusés ou absents (jeton start.gg).
    Unauthorized,
    /// Requête trop coûteuse pour la source (complexité GraphQL) : à refaire en plus petit.
    TooComplex,
    /// Disjoncteur ouvert : la source n'est plus appelée pendant un moment.
    CircuitOpen,
}

impl ConnectorError {
    /// Une nouvelle tentative a des chances d'aboutir.
    pub fn is_transient(&self) -> bool {
        matches!(
            self,
            ConnectorError::RateLimited { .. }
                | ConnectorError::Timeout
                | ConnectorError::Unavailable(_)
        )
    }
}

impl fmt::Display for ConnectorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConnectorError::InvalidUrl(detail) => write!(f, "URL refusée : {detail}"),
            ConnectorError::NotFound => f.write_str("introuvable chez la source"),
            ConnectorError::Unsupported(what) => write!(f, "non pris en charge : {what}"),
            ConnectorError::RateLimited { .. } => f.write_str("limite de requêtes de la source"),
            ConnectorError::Timeout => f.write_str("délai dépassé"),
            ConnectorError::Unavailable(detail) => write!(f, "source indisponible : {detail}"),
            ConnectorError::Unauthorized => f.write_str("accès refusé par la source"),
            ConnectorError::TooComplex => f.write_str("requête trop coûteuse pour la source"),
            ConnectorError::CircuitOpen => f.write_str("source suspendue après des échecs"),
        }
    }
}

impl std::error::Error for ConnectorError {}

/// Source externe de tournois.
///
/// Un connecteur ne fait que lire sa source et la traduire dans le modèle canonique : la
/// persistance, l'identité locale, la synchronisation et la résilience (cache, limite de
/// requêtes, reprises, disjoncteur) sont communes à tous (voir [`crate::sync`] et
/// [`crate::resilience`]).
#[async_trait]
pub trait TournamentConnector: Send + Sync {
    /// Identifiant stable, stocké avec chaque donnée importée (`"startgg"`).
    fn id(&self) -> &'static str;

    /// Nom affiché.
    fn display_name(&self) -> &'static str;

    /// Ce que la source sait fournir en général.
    fn capabilities(&self) -> Capabilities;

    /// Recherche de tournois par nom.
    async fn search(&self, query: &str) -> Result<Vec<ExternalTournamentRef>, ConnectorError>;

    /// Tournoi désigné par une URL de la source. L'URL est seulement analysée : seuls les hôtes
    /// de la source sont acceptés, et aucune requête n'est faite vers l'URL elle-même.
    async fn resolve_url(&self, url: &str) -> Result<ExternalTournamentRef, ConnectorError>;

    /// Épreuves du tournoi, pour choisir celles à importer.
    async fn list_events(
        &self,
        tournament: &ExternalTournamentRef,
    ) -> Result<Vec<ExternalEventRef>, ConnectorError>;

    /// Instantané complet des épreuves `event_ids`.
    async fn fetch(
        &self,
        tournament: &ExternalTournamentRef,
        event_ids: &[String],
    ) -> Result<ExternalTournament, ConnectorError>;

    /// Changements depuis `cursor`. Par défaut, un instantané complet : un connecteur sans
    /// synchronisation incrémentale n'a rien d'autre à écrire.
    async fn fetch_updates(
        &self,
        tournament: &ExternalTournamentRef,
        event_ids: &[String],
        cursor: SyncCursor,
    ) -> Result<ExternalDelta, ConnectorError> {
        let _ = cursor;
        Ok(ExternalDelta::Full {
            tournament: self.fetch(tournament, event_ids).await?,
        })
    }
}
