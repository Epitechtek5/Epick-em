//! Persistance des comptes et des jetons de rafraîchissement.
//!
//! Le trait [`AuthStore`] isole les handlers de PostgreSQL : [`PgStore`] sert en production,
//! [`MemoryStore`] sert aux tests sans base.

mod memory;
mod postgres;

pub use self::memory::MemoryStore;
pub use self::postgres::PgStore;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use std::time::Duration;
use uuid::Uuid;

/// Rôle d'un compte. Toute inscription crée un `User` ; `Admin` se donne en base.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Admin,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::User => "user",
            Role::Admin => "admin",
        }
    }
}

impl FromStr for Role {
    type Err = StoreError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "user" => Ok(Role::User),
            "admin" => Ok(Role::Admin),
            other => Err(StoreError::Other(format!("rôle inconnu : {other}"))),
        }
    }
}

#[derive(Debug, Clone)]
pub struct UserRecord {
    pub id: Uuid,
    pub username: String,
    pub password_hash: String,
    pub role: Role,
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

    /// Révoque `old_hash` s'il est valide (existant, non révoqué, non expiré) et appartient à
    /// `user_id`, et enregistre `new_hash` à sa place, en une seule opération. Renvoie `false`
    /// si `old_hash` est inutilisable (rien n'est alors enregistré ni révoqué).
    async fn rotate_refresh_token(
        &self,
        user_id: Uuid,
        old_hash: &str,
        new_hash: &str,
        ttl: Duration,
    ) -> Result<bool, StoreError>;

    /// Révoque le jeton s'il appartient à `user_id` ; un jeton inconnu, déjà révoqué ou
    /// appartenant à un autre compte n'est pas une erreur (et n'est pas modifié).
    async fn revoke_refresh_token(&self, user_id: Uuid, token_hash: &str)
    -> Result<(), StoreError>;
}
