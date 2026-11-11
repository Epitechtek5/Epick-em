//! Sources de tournois externes (ADR-003) : interface commune, modèle canonique, registre,
//! résilience, synchronisation, et les connecteurs start.gg et « fichiers JSON ».
//!
//! Brancher une nouvelle source = implémenter [`TournamentConnector`] et l'ajouter au
//! [`ConnectorRegistry`] (voir `docs/connecteurs.md`) : ni la persistance, ni la
//! synchronisation, ni l'API ne changent.

pub mod connector;
pub mod json_file;
pub mod model;
pub mod registry;
pub mod resilience;
pub mod startgg;
pub mod sync;

pub use connector::{ConnectorError, TournamentConnector};
pub use registry::ConnectorRegistry;
pub use resilience::{ResiliencePolicy, ResilientConnector};

use infra::Cache;
use std::sync::Arc;

/// Registre des sources configurées dans l'environnement, chacune enveloppée dans la
/// résilience commune :
/// - start.gg si `STARTGG_TOKEN` est renseignée ;
/// - fichiers JSON si `EXTERNAL_JSON_DIR` l'est (démonstration, tutoriel).
pub fn registry_from_env(
    cache: Option<Arc<dyn Cache>>,
) -> Result<ConnectorRegistry, reqwest::Error> {
    registry_from_lookup(|name| std::env::var(name).ok(), cache)
}

/// Variante testable de [`registry_from_env`].
pub fn registry_from_lookup(
    lookup: impl Fn(&str) -> Option<String>,
    cache: Option<Arc<dyn Cache>>,
) -> Result<ConnectorRegistry, reqwest::Error> {
    let get = |name: &str| lookup(name).filter(|v| !v.trim().is_empty());
    let mut registry = ConnectorRegistry::new();
    let wrap = |inner: Arc<dyn TournamentConnector>| -> Arc<dyn TournamentConnector> {
        Arc::new(ResilientConnector::new(
            inner,
            ResiliencePolicy::default(),
            cache.clone(),
        ))
    };
    if let Some(token) = get("STARTGG_TOKEN") {
        registry = registry.register(wrap(Arc::new(startgg::StartGgConnector::with_token(
            token.trim(),
        )?)));
    }
    if let Some(dir) = get("EXTERNAL_JSON_DIR") {
        registry = registry.register(wrap(Arc::new(json_file::JsonFileConnector::new(dir))));
    }
    Ok(registry)
}
