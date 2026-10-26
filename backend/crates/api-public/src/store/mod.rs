//! Persistance des comptes et des jetons de rafraîchissement.
//!
//! Le trait [`AuthStore`] isole les handlers de PostgreSQL : [`PgStore`] sert en production,
//! [`MemoryStore`] sert aux tests sans base.

mod games;
mod memory;
mod postgres;
mod stats;

pub use self::games::{Game, GameInput, GameUpdate};
pub use self::memory::MemoryStore;
pub use self::postgres::PgStore;
pub use self::stats::{Stat, StatInput, StatType, StatUpdate};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use std::time::Duration;
use uuid::Uuid;

/// Rôle d'un compte. Toute inscription crée un `User` ; un administrateur peut changer le rôle
/// d'un compte (`PATCH /user/{id}/update`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Admin,
    Watcher,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::User => "user",
            Role::Admin => "admin",
            Role::Watcher => "watcher",
        }
    }
}

impl FromStr for Role {
    type Err = StoreError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "user" => Ok(Role::User),
            "admin" => Ok(Role::Admin),
            "watcher" => Ok(Role::Watcher),
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

/// Vue publique d'un compte : jamais l'empreinte du mot de passe. C'est aussi la valeur mise en
/// cache (voir [`PgStore`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
pub struct UserProfile {
    pub id: Uuid,
    pub username: String,
    pub role: Role,
}

impl From<&UserRecord> for UserProfile {
    fn from(user: &UserRecord) -> Self {
        UserProfile {
            id: user.id,
            username: user.username.clone(),
            role: user.role,
        }
    }
}

/// Modification partielle d'un compte : seuls les champs renseignés changent.
#[derive(Debug, Default, Clone)]
pub struct UserUpdate {
    pub username: Option<String>,
    pub password_hash: Option<String>,
    pub role: Option<Role>,
}

#[derive(Debug)]
pub enum StoreError {
    /// Le nom d'utilisateur existe déjà (sans tenir compte de la casse).
    UsernameTaken,
    /// Le nom de jeu existe déjà (sans tenir compte de la casse).
    GameNameTaken,
    /// La clé de statistique existe déjà.
    StatKeyTaken,
    /// La statistique est utilisée par le barème d'un tournoi en cours.
    StatInUse,
    Other(String),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::UsernameTaken => f.write_str("nom d'utilisateur déjà pris"),
            StoreError::GameNameTaken => f.write_str("nom de jeu déjà pris"),
            StoreError::StatKeyTaken => f.write_str("clé de statistique déjà prise"),
            StoreError::StatInUse => f.write_str("statistique utilisée par un tournoi en cours"),
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

    /// Profil public d'un compte (sans empreinte de mot de passe), éventuellement mis en cache.
    async fn find_profile(&self, id: Uuid) -> Result<Option<UserProfile>, StoreError>;

    /// Comptes par ordre de création, `limit` à partir de `offset`.
    async fn list_profiles(&self, limit: i64, offset: i64) -> Result<Vec<UserProfile>, StoreError>;

    /// Applique `update` ; `None` si le compte n'existe pas, [`StoreError::UsernameTaken`] si le
    /// nouveau nom est déjà utilisé.
    async fn update_user(
        &self,
        id: Uuid,
        update: UserUpdate,
    ) -> Result<Option<UserProfile>, StoreError>;

    /// Supprime le compte (et ses jetons de rafraîchissement) ; `false` s'il n'existait pas.
    async fn delete_user(&self, id: Uuid) -> Result<bool, StoreError>;

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

    /// Jeux par ordre de nom, `limit` à partir de `offset`.
    async fn list_games(&self, limit: i64, offset: i64) -> Result<Vec<Game>, StoreError>;

    async fn find_game(&self, id: Uuid) -> Result<Option<Game>, StoreError>;

    /// Crée le jeu ; [`StoreError::GameNameTaken`] si le nom est déjà utilisé.
    async fn create_game(&self, game: GameInput) -> Result<Game, StoreError>;

    /// Applique `update` ; `None` si le jeu n'existe pas, [`StoreError::GameNameTaken`] si le
    /// nouveau nom est déjà utilisé.
    async fn update_game(&self, id: Uuid, update: GameUpdate) -> Result<Option<Game>, StoreError>;

    /// Supprime le jeu ; `false` s'il n'existait pas.
    async fn delete_game(&self, id: Uuid) -> Result<bool, StoreError>;

    /// Crée ou met à jour (par nom, sans tenir compte de la casse) les jeux donnés, en une
    /// seule opération : en cas d'erreur, aucun n'est modifié. Chaque jeu est renvoyé avec
    /// `true` s'il vient d'être créé. Les noms de `games` sont distincts.
    async fn upsert_games(&self, games: Vec<GameInput>) -> Result<Vec<(Game, bool)>, StoreError>;

    /// Statistiques par ordre de nom, `limit` à partir de `offset`.
    async fn list_stats(&self, limit: i64, offset: i64) -> Result<Vec<Stat>, StoreError>;

    async fn find_stat(&self, id: Uuid) -> Result<Option<Stat>, StoreError>;

    /// Crée la statistique ; [`StoreError::StatKeyTaken`] si la clé est déjà utilisée.
    async fn create_stat(&self, stat: StatInput) -> Result<Stat, StoreError>;

    /// Applique `update` ; `None` si la statistique n'existe pas, [`StoreError::StatKeyTaken`]
    /// si la nouvelle clé est déjà utilisée.
    async fn update_stat(&self, id: Uuid, update: StatUpdate) -> Result<Option<Stat>, StoreError>;

    /// Supprime la statistique (et ses liaisons avec les jeux) ; `false` si elle n'existait pas,
    /// [`StoreError::StatInUse`] si le barème d'un tournoi `ongoing` s'en sert.
    async fn delete_stat(&self, id: Uuid) -> Result<bool, StoreError>;

    /// Statistiques liées au jeu, par ordre de nom ; `None` si le jeu n'existe pas.
    async fn list_game_stats(&self, game_id: Uuid) -> Result<Option<Vec<Stat>>, StoreError>;

    /// Lie la statistique au jeu (sans effet si elle l'est déjà) ; `false` si le jeu ou la
    /// statistique n'existe pas.
    async fn link_stat(&self, game_id: Uuid, stat_id: Uuid) -> Result<bool, StoreError>;

    /// Délie la statistique du jeu ; `false` si elle n'y était pas liée.
    async fn unlink_stat(&self, game_id: Uuid, stat_id: Uuid) -> Result<bool, StoreError>;
}
