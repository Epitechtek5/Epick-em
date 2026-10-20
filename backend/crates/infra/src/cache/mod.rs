//! Interface de cache clé/valeur et ses implémentations.
//!
//! Le trait manipule des octets pour rester utilisable en objet (`Arc<dyn Cache>`) ;
//! la (dé)sérialisation des valeurs est faite par [`crate::CachedDb`].

mod memory;
mod redis;
mod ttl;

pub use self::memory::MemoryCache;
pub use self::redis::RedisCache;
pub use self::ttl::Ttl;

use async_trait::async_trait;
use std::fmt;

#[derive(Debug)]
pub struct CacheError(pub String);

impl fmt::Display for CacheError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for CacheError {}

#[async_trait]
pub trait Cache: Send + Sync {
    /// Valeur associée à `key`, ou `None` si elle est absente ou expirée.
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, CacheError>;

    /// Écrit `value` sous `key` ; l'entrée expire au bout de `ttl`.
    async fn set(&self, key: &str, value: Vec<u8>, ttl: Ttl) -> Result<(), CacheError>;

    /// Supprime les clés données ; une clé absente n'est pas une erreur.
    async fn delete(&self, keys: &[&str]) -> Result<(), CacheError>;
}
