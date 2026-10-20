//! Requêtes sqlx adossées au cache.
//!
//! Chaque méthode reçoit une clé et une closure qui exécute la requête sur le pool :
//!
//! ```no_run
//! # async fn example(db: infra::CachedDb, id: i64) -> Result<(), sqlx::Error> {
//! use infra::Ttl;
//! const TTL: Ttl = Ttl::from_mins(5);
//! let key = format!("user:{id}:username");
//!
//! // Lecture : cache, sinon base puis mise en cache pour `TTL`.
//! let username: Option<String> = db
//!     .read_optional(&key, TTL, |pool| async move {
//!         sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
//!             .bind(id)
//!             .fetch_optional(&pool)
//!             .await
//!     })
//!     .await?;
//!
//! // Écriture : base, puis le résultat remplace l'entrée en cache.
//! let username: String = db
//!     .write(&key, TTL, |pool| async move {
//!         sqlx::query_scalar("UPDATE users SET username = $2 WHERE id = $1 RETURNING username")
//!             .bind(id)
//!             .bind("nouveau")
//!             .fetch_one(&pool)
//!             .await
//!     })
//!     .await?;
//!
//! // Suppression : base, puis invalidation des clés données.
//! db.delete(&[&key, "users:list"], |pool| async move {
//!     sqlx::query("DELETE FROM users WHERE id = $1")
//!         .bind(id)
//!         .execute(&pool)
//!         .await
//! })
//! .await?;
//! # Ok(())
//! # }
//! ```
//!
//! Le cache n'est qu'une optimisation : une erreur de cache (Redis indisponible, valeur
//! illisible) est journalisée puis ignorée, et la requête est servie par la base. Seules
//! les erreurs sqlx remontent. En contrepartie, une invalidation ratée laisse une valeur
//! périmée jusqu'à l'expiration de son TTL : choisir les TTL en conséquence.

use crate::cache::Cache;
use crate::cache::Ttl;
use serde::Serialize;
use serde::de::DeserializeOwned;
use sqlx::PgPool;
use std::future::Future;
use std::sync::Arc;

/// Pool PostgreSQL et cache, partagés par les handlers. Le cloner est peu coûteux.
#[derive(Clone)]
pub struct CachedDb {
    pool: PgPool,
    cache: Arc<dyn Cache>,
}

impl CachedDb {
    pub fn new(pool: PgPool, cache: Arc<dyn Cache>) -> Self {
        CachedDb { pool, cache }
    }

    /// Pool brut, pour les requêtes qui ne passent pas par le cache.
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub fn cache(&self) -> &Arc<dyn Cache> {
        &self.cache
    }

    /// Lit `key` en cache ; à défaut, exécute `query` et met son résultat en cache.
    pub async fn read<T, F, Fut>(&self, key: &str, ttl: Ttl, query: F) -> Result<T, sqlx::Error>
    where
        T: Serialize + DeserializeOwned,
        F: FnOnce(PgPool) -> Fut,
        Fut: Future<Output = Result<T, sqlx::Error>>,
    {
        if let Some(value) = self.cached(key).await {
            return Ok(value);
        }
        let value = query(self.pool.clone()).await?;
        self.store(key, &value, ttl).await;
        Ok(value)
    }

    /// Comme [`CachedDb::read`], mais un résultat `None` n'est pas mis en cache : la
    /// ligne pourra être trouvée dès sa création, sans attendre l'expiration.
    pub async fn read_optional<T, F, Fut>(
        &self,
        key: &str,
        ttl: Ttl,
        query: F,
    ) -> Result<Option<T>, sqlx::Error>
    where
        T: Serialize + DeserializeOwned,
        F: FnOnce(PgPool) -> Fut,
        Fut: Future<Output = Result<Option<T>, sqlx::Error>>,
    {
        if let Some(value) = self.cached(key).await {
            return Ok(Some(value));
        }
        let value = query(self.pool.clone()).await?;
        if let Some(value) = &value {
            self.store(key, value, ttl).await;
        }
        Ok(value)
    }

    /// Exécute la requête d'écriture `query`, puis écrit son résultat sous `key`.
    pub async fn write<T, F, Fut>(&self, key: &str, ttl: Ttl, query: F) -> Result<T, sqlx::Error>
    where
        T: Serialize,
        F: FnOnce(PgPool) -> Fut,
        Fut: Future<Output = Result<T, sqlx::Error>>,
    {
        let value = query(self.pool.clone()).await?;
        self.store(key, &value, ttl).await;
        Ok(value)
    }

    /// Exécute `query`, puis invalide `keys`. Sert aux suppressions, et à toute écriture
    /// dont le résultat ne doit pas être mis en cache (listes, agrégats…).
    pub async fn delete<T, F, Fut>(&self, keys: &[&str], query: F) -> Result<T, sqlx::Error>
    where
        F: FnOnce(PgPool) -> Fut,
        Fut: Future<Output = Result<T, sqlx::Error>>,
    {
        let value = query(self.pool.clone()).await?;
        self.invalidate(keys).await;
        Ok(value)
    }

    /// Supprime `keys` du cache, sans toucher à la base.
    pub async fn invalidate(&self, keys: &[&str]) {
        if let Err(err) = self.cache.delete(keys).await {
            eprintln!("cache : échec de l'invalidation de {keys:?} : {err}");
        }
    }

    async fn cached<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        let bytes = match self.cache.get(key).await {
            Ok(bytes) => bytes?,
            Err(err) => {
                eprintln!("cache : échec de la lecture de {key} : {err}");
                return None;
            }
        };
        // Une valeur illisible (format changé entre deux versions, par exemple) est
        // traitée comme absente : elle sera remplacée par le résultat de la requête.
        serde_json::from_slice(&bytes)
            .inspect_err(|err| eprintln!("cache : valeur illisible sous {key} : {err}"))
            .ok()
    }

    async fn store<T: Serialize>(&self, key: &str, value: &T, ttl: Ttl) {
        let bytes = match serde_json::to_vec(value) {
            Ok(bytes) => bytes,
            Err(err) => {
                eprintln!("cache : sérialisation impossible pour {key} : {err}");
                return;
            }
        };
        if let Err(err) = self.cache.set(key, bytes, ttl).await {
            eprintln!("cache : échec de l'écriture de {key} : {err}");
        }
    }
}
