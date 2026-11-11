//! Registre des connecteurs : le cœur choisit un connecteur par son identifiant ou par l'URL,
//! sans connaître aucun fournisseur.

use crate::connector::{ConnectorError, TournamentConnector};
use crate::model::ExternalTournamentRef;
use std::sync::Arc;

#[derive(Default, Clone)]
pub struct ConnectorRegistry {
    connectors: Vec<Arc<dyn TournamentConnector>>,
}

impl ConnectorRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Ajoute un connecteur ; il remplace celui de même identifiant.
    pub fn register(mut self, connector: Arc<dyn TournamentConnector>) -> Self {
        self.connectors.retain(|c| c.id() != connector.id());
        self.connectors.push(connector);
        self
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn TournamentConnector>> {
        self.connectors.iter().find(|c| c.id() == id).cloned()
    }

    pub fn all(&self) -> &[Arc<dyn TournamentConnector>] {
        &self.connectors
    }

    /// Premier connecteur qui reconnaît l'URL. [`ConnectorError::InvalidUrl`] si aucun ne la
    /// reconnaît ; toute autre erreur est celle du connecteur qui l'a reconnue.
    pub async fn resolve_url(
        &self,
        url: &str,
    ) -> Result<(Arc<dyn TournamentConnector>, ExternalTournamentRef), ConnectorError> {
        for connector in &self.connectors {
            match connector.resolve_url(url).await {
                Ok(reference) => return Ok((connector.clone(), reference)),
                Err(ConnectorError::InvalidUrl(_)) => continue,
                Err(other) => return Err(other),
            }
        }
        Err(ConnectorError::InvalidUrl(
            "aucune source ne reconnaît cette URL".into(),
        ))
    }
}
