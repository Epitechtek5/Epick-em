//! Cache en mémoire, pour les tests et le développement sans Redis.

use super::Ttl;
use super::{Cache, CacheError};
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

#[derive(Default)]
pub struct MemoryCache {
    entries: Mutex<HashMap<String, (Vec<u8>, Instant)>>,
}

impl MemoryCache {
    pub fn new() -> Self {
        Self::default()
    }

    fn entries(&self) -> std::sync::MutexGuard<'_, HashMap<String, (Vec<u8>, Instant)>> {
        // Aucune opération ne peut laisser la table incohérente : un verrou empoisonné
        // par une panique ailleurs reste utilisable.
        self.entries.lock().unwrap_or_else(|err| err.into_inner())
    }
}

#[async_trait]
impl Cache for MemoryCache {
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, CacheError> {
        let mut entries = self.entries();
        match entries.get(key) {
            Some((value, expires_at)) if *expires_at > Instant::now() => Ok(Some(value.clone())),
            Some(_) => {
                entries.remove(key);
                Ok(None)
            }
            None => Ok(None),
        }
    }

    async fn set(&self, key: &str, value: Vec<u8>, ttl: Ttl) -> Result<(), CacheError> {
        self.entries()
            .insert(key.to_owned(), (value, Instant::now() + ttl.as_duration()));
        Ok(())
    }

    async fn delete(&self, keys: &[&str]) -> Result<(), CacheError> {
        let mut entries = self.entries();
        for key in keys {
            entries.remove(*key);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn set_get_delete() {
        let cache = MemoryCache::new();
        assert_eq!(cache.get("k").await.unwrap(), None);
        cache
            .set("k", b"v".to_vec(), Ttl::from_secs(60))
            .await
            .unwrap();
        assert_eq!(cache.get("k").await.unwrap(), Some(b"v".to_vec()));
        cache.delete(&["k", "absent"]).await.unwrap();
        assert_eq!(cache.get("k").await.unwrap(), None);
    }

    #[tokio::test]
    async fn entries_expire() {
        let cache = MemoryCache::new();
        cache
            .set("k", b"v".to_vec(), Ttl::from_secs(1))
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        assert_eq!(cache.get("k").await.unwrap(), None);
    }
}
