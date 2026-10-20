//! Cache Redis (ADR-002 : Redis sert à la fois de bus d'événements et de cache).

use super::Ttl;
use super::{Cache, CacheError};
use async_trait::async_trait;
use redis::AsyncCommands;
use redis::aio::ConnectionManager;

/// Client Redis partagé. `ConnectionManager` multiplexe les commandes sur une seule
/// connexion et se reconnecte seul : le cloner est peu coûteux.
#[derive(Clone)]
pub struct RedisCache {
    connection: ConnectionManager,
}

impl RedisCache {
    pub async fn connect(url: &str) -> Result<Self, CacheError> {
        let client = redis::Client::open(url).map_err(to_cache_error)?;
        let connection = ConnectionManager::new(client)
            .await
            .map_err(to_cache_error)?;
        Ok(RedisCache { connection })
    }

    /// Connexion brute, pour les usages hors cache (Streams, Pub/Sub…).
    pub fn connection(&self) -> ConnectionManager {
        self.connection.clone()
    }
}

#[async_trait]
impl Cache for RedisCache {
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, CacheError> {
        self.connection
            .clone()
            .get(key)
            .await
            .map_err(to_cache_error)
    }

    async fn set(&self, key: &str, value: Vec<u8>, ttl: Ttl) -> Result<(), CacheError> {
        self.connection
            .clone()
            .set_ex(key, value, ttl.as_secs())
            .await
            .map_err(to_cache_error)
    }

    async fn delete(&self, keys: &[&str]) -> Result<(), CacheError> {
        if keys.is_empty() {
            return Ok(());
        }
        self.connection
            .clone()
            .del::<_, ()>(keys)
            .await
            .map_err(to_cache_error)
    }
}

fn to_cache_error(err: redis::RedisError) -> CacheError {
    CacheError(err.to_string())
}
