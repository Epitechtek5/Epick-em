//! Accès aux infrastructures partagées par les binaires : PostgreSQL, Redis et cache.
//!
//! - [`config`] lit la configuration dans l'environnement ;
//! - [`db`] ouvre le pool PostgreSQL ;
//! - [`cache`] définit le trait [`Cache`] et ses implémentations (Redis, mémoire) ;
//! - [`cached`] associe une requête sqlx à une entrée de cache ([`CachedDb`]).

pub mod cache;
pub mod cached;
pub mod config;
pub mod db;

pub use cache::{Cache, CacheError, MemoryCache, RedisCache, Ttl};
pub use cached::CachedDb;
pub use config::Config;

use std::fmt;
use std::sync::Arc;

/// Échec de connexion au démarrage d'un service.
#[derive(Debug)]
pub enum ConnectError {
    Database(sqlx::Error),
    Redis(CacheError),
}

impl fmt::Display for ConnectError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConnectError::Database(err) => write!(f, "connexion à PostgreSQL impossible : {err}"),
            ConnectError::Redis(err) => write!(f, "connexion à Redis impossible : {err}"),
        }
    }
}

impl std::error::Error for ConnectError {}

/// Ouvre PostgreSQL et Redis. Échoue immédiatement si l'un des deux est injoignable :
/// en Compose comme en Kubernetes, le service redémarre jusqu'à ce qu'ils soient prêts.
pub async fn connect(config: &Config) -> Result<CachedDb, ConnectError> {
    let pool = db::connect(config).await.map_err(ConnectError::Database)?;
    let cache = RedisCache::connect(&config.redis_url)
        .await
        .map_err(ConnectError::Redis)?;
    Ok(CachedDb::new(pool, Arc::new(cache)))
}
