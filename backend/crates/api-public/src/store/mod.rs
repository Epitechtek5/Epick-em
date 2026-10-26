//! Persistance des comptes et des jetons de rafraîchissement.
//!
//! Le trait [`AuthStore`] isole les handlers de PostgreSQL : [`PgStore`] sert en production,
//! [`MemoryStore`] sert aux tests sans base.

mod games;
mod memory;
mod postgres;
mod stats;
mod teams;
mod tournaments;

pub use self::games::{Game, GameInput, GameUpdate};
pub use self::memory::MemoryStore;
pub use self::postgres::PgStore;
pub use self::stats::{Stat, StatInput, StatType, StatUpdate};
pub use self::teams::{
    MemberImport, Team, TeamImport, TeamInput, TeamMember, TeamRole, TeamUpdate, TournamentTeam,
    TournamentTeamInput, TournamentTeamMember,
};
pub use self::tournaments::{
    ParticipantStatus, ParticipantType, ScoringMode, ScoringRule, TeamScoringMode, Tournament,
    TournamentInput, TournamentParticipant, TournamentStatus,
};

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
    /// Le nom d'équipe existe déjà pour ce jeu (sans tenir compte de la casse).
    TeamNameTaken,
    /// Le compte est déjà membre actif de l'équipe.
    AlreadyTeamMember,
    /// L'équipe globale est déjà inscrite à ce tournoi.
    TeamAlreadyRegistered,
    /// Le joueur est déjà dans une équipe de ce tournoi.
    PlayerAlreadyRegistered,
    Other(String),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::UsernameTaken => f.write_str("nom d'utilisateur déjà pris"),
            StoreError::GameNameTaken => f.write_str("nom de jeu déjà pris"),
            StoreError::StatKeyTaken => f.write_str("clé de statistique déjà prise"),
            StoreError::StatInUse => f.write_str("statistique utilisée par un tournoi en cours"),
            StoreError::TeamNameTaken => f.write_str("nom d'équipe déjà pris"),
            StoreError::AlreadyTeamMember => f.write_str("compte déjà membre de l'équipe"),
            StoreError::TeamAlreadyRegistered => f.write_str("équipe déjà inscrite au tournoi"),
            StoreError::PlayerAlreadyRegistered => {
                f.write_str("joueur déjà dans une équipe du tournoi")
            }
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

    /// Crée ou met à jour (par clé) les statistiques données, en une seule opération : en cas
    /// d'erreur, aucune n'est modifiée. Chacune est renvoyée avec `true` si elle vient d'être
    /// créée. Les clés de `stats` sont distinctes.
    async fn upsert_stats(&self, stats: Vec<StatInput>) -> Result<Vec<(Stat, bool)>, StoreError>;

    /// Remplace les statistiques liées au jeu par `stat_ids`, en une seule opération. `false`
    /// si le jeu ou l'une des statistiques n'existe pas (rien n'est alors modifié).
    async fn set_game_stats(&self, game_id: Uuid, stat_ids: Vec<Uuid>) -> Result<bool, StoreError>;

    /// Remplace les jeux liés à la statistique par `game_ids`, en une seule opération. `false`
    /// si la statistique ou l'un des jeux n'existe pas (rien n'est alors modifié).
    async fn set_stat_games(&self, stat_id: Uuid, game_ids: Vec<Uuid>) -> Result<bool, StoreError>;

    /// Équipes globales par ordre de nom, éventuellement d'un seul jeu, `limit` à partir de
    /// `offset`.
    async fn list_teams(
        &self,
        game_id: Option<Uuid>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Team>, StoreError>;

    async fn find_team(&self, id: Uuid) -> Result<Option<Team>, StoreError>;

    /// Crée l'équipe et y inscrit son propriétaire (rôle `owner`) ;
    /// [`StoreError::TeamNameTaken`] si le nom est déjà pris pour ce jeu. Le jeu et le
    /// propriétaire existent.
    async fn create_team(&self, team: TeamInput) -> Result<Team, StoreError>;

    /// Applique `update` ; `None` si l'équipe n'existe pas, [`StoreError::TeamNameTaken`] si le
    /// nouveau nom est déjà pris pour ce jeu.
    async fn update_team(&self, id: Uuid, update: TeamUpdate) -> Result<Option<Team>, StoreError>;

    /// Supprime l'équipe et ses membres ; les équipes de tournoi copiées sont conservées
    /// (`team_id` repasse à `null`). `false` si elle n'existait pas.
    async fn delete_team(&self, id: Uuid) -> Result<bool, StoreError>;

    /// Membres de l'équipe, actuels et anciens, par date d'arrivée ; `None` si elle n'existe pas.
    async fn list_team_members(&self, team_id: Uuid)
    -> Result<Option<Vec<TeamMember>>, StoreError>;

    /// Ajoute le compte à l'équipe ; `None` si l'équipe ou le compte n'existe pas,
    /// [`StoreError::AlreadyTeamMember`] s'il en est déjà membre actif.
    async fn add_team_member(
        &self,
        team_id: Uuid,
        user_id: Uuid,
        role: TeamRole,
    ) -> Result<Option<TeamMember>, StoreError>;

    /// Change le rôle d'un membre actif ; `None` s'il n'en est pas un.
    async fn set_team_member_role(
        &self,
        team_id: Uuid,
        user_id: Uuid,
        role: TeamRole,
    ) -> Result<Option<TeamMember>, StoreError>;

    /// Fait quitter l'équipe à un membre actif (la ligne est conservée avec `left_at`) ;
    /// `false` s'il n'en était pas un.
    async fn remove_team_member(&self, team_id: Uuid, user_id: Uuid) -> Result<bool, StoreError>;

    /// Crée ou met à jour (par jeu et nom, sans tenir compte de la casse) les équipes données,
    /// en une seule opération : en cas d'erreur, aucune n'est modifiée. Les membres d'une équipe
    /// existante sont **remplacés** par ceux du fichier. Chaque équipe est renvoyée avec `true`
    /// si elle vient d'être créée. Les couples (jeu, nom) sont distincts, les jeux et les
    /// comptes existent, et les membres respectent les contraintes d'appartenance (un seul
    /// `owner` actif, un seul passage actif par compte).
    async fn import_teams(&self, teams: Vec<TeamImport>) -> Result<Vec<(Team, bool)>, StoreError>;

    /// Équipes d'un tournoi par ordre de nom, `limit` à partir de `offset`.
    async fn list_tournament_teams(
        &self,
        tournament_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<TournamentTeam>, StoreError>;

    async fn find_tournament_team(&self, id: Uuid) -> Result<Option<TournamentTeam>, StoreError>;

    /// Crée l'équipe de tournoi et ses membres en une seule opération ;
    /// [`StoreError::TeamAlreadyRegistered`] si l'équipe globale d'origine est déjà inscrite à
    /// ce tournoi, [`StoreError::PlayerAlreadyRegistered`] si un membre est déjà dans une autre
    /// équipe du tournoi.
    async fn create_tournament_team(
        &self,
        team: TournamentTeamInput,
    ) -> Result<TournamentTeam, StoreError>;

    /// Applique `update` ; `None` si l'équipe de tournoi n'existe pas. Aucune propagation vers
    /// l'équipe globale d'origine.
    async fn update_tournament_team(
        &self,
        id: Uuid,
        update: TeamUpdate,
    ) -> Result<Option<TournamentTeam>, StoreError>;

    /// Supprime l'équipe de tournoi et ses membres ; `false` si elle n'existait pas.
    async fn delete_tournament_team(&self, id: Uuid) -> Result<bool, StoreError>;

    /// Membres de l'équipe de tournoi ; `None` si elle n'existe pas.
    async fn list_tournament_team_members(
        &self,
        id: Uuid,
    ) -> Result<Option<Vec<TournamentTeamMember>>, StoreError>;

    /// Ajoute le compte à l'équipe de tournoi ; `None` si l'équipe ou le compte n'existe pas,
    /// [`StoreError::PlayerAlreadyRegistered`] s'il est déjà dans une équipe de ce tournoi.
    async fn add_tournament_team_member(
        &self,
        id: Uuid,
        user_id: Uuid,
        role: TeamRole,
    ) -> Result<Option<TournamentTeamMember>, StoreError>;

    /// Change le rôle d'un membre ; `None` s'il n'est pas dans l'équipe.
    async fn set_tournament_team_member_role(
        &self,
        id: Uuid,
        user_id: Uuid,
        role: TeamRole,
    ) -> Result<Option<TournamentTeamMember>, StoreError>;

    /// Retire un membre de l'équipe de tournoi ; `false` s'il n'y était pas.
    async fn remove_tournament_team_member(
        &self,
        id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, StoreError>;
}
