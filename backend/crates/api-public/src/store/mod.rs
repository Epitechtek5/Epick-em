//! Persistance des comptes et des jetons de rafraîchissement.
//!
//! Le trait [`AuthStore`] isole les handlers de PostgreSQL : [`PgStore`] sert en production,
//! [`MemoryStore`] sert aux tests sans base.

mod memory;
mod postgres;

pub use self::memory::MemoryStore;
pub use self::postgres::PgStore;

use async_trait::async_trait;
use std::fmt;
use std::time::Duration;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct UserRecord {
    pub id: Uuid,
    pub username: String,
    pub password_hash: String,
}

#[derive(Debug)]
pub enum StoreError {
    /// Le nom d'utilisateur existe déjà (sans tenir compte de la casse).
    UsernameTaken,
    Other(String),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::UsernameTaken => f.write_str("nom d'utilisateur déjà pris"),
            StoreError::Other(detail) => f.write_str(detail),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<sqlx::Error> for StoreError {
    fn from(err: sqlx::Error) -> Self {
        StoreError::Other(err.to_string())
    }
}

#[async_trait]
pub trait AuthStore: Send + Sync {
    /// Crée le compte ; [`StoreError::UsernameTaken`] si le nom est déjà utilisé.
    async fn create_user(
        &self,
        username: &str,
        password_hash: &str,
    ) -> Result<UserRecord, StoreError>;

    /// Cherche un compte par nom d'utilisateur, sans tenir compte de la casse.
    async fn find_user_by_username(&self, username: &str)
    -> Result<Option<UserRecord>, StoreError>;

    async fn find_user_by_id(&self, id: Uuid) -> Result<Option<UserRecord>, StoreError>;

    /// Enregistre l'empreinte d'un jeton de rafraîchissement valable pendant `ttl`.
    async fn insert_refresh_token(
        &self,
        user_id: Uuid,
        token_hash: &str,
        ttl: Duration,
    ) -> Result<(), StoreError>;

    /// Révoque `old_hash` s'il est valide (existant, non révoqué, non expiré) et enregistre
    /// `new_hash` à sa place, en une seule opération. Renvoie le propriétaire du jeton, ou
    /// `None` si `old_hash` est inutilisable (rien n'est alors enregistré).
    async fn rotate_refresh_token(
        &self,
        old_hash: &str,
        new_hash: &str,
        ttl: Duration,
    ) -> Result<Option<Uuid>, StoreError>;

    /// Révoque le jeton ; un jeton inconnu ou déjà révoqué n'est pas une erreur.
    async fn revoke_refresh_token(&self, token_hash: &str) -> Result<(), StoreError>;
}
