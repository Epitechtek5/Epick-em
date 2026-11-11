//! Persistance de la sécurité des comptes : identités Google (OIDC), double authentification
//! TOTP, défis de second facteur et limitation des tentatives.
//!
//! Tout ce qui est secret est stocké sous forme d'empreinte SHA-256 (`state`, défis, codes de
//! récupération) ou chiffré (secret TOTP, voir [`crate::totp`]).

use super::{StoreError, UserRecord};
use async_trait::async_trait;
use std::time::Duration;
use uuid::Uuid;

/// Fournisseur d'identité externe. Seul Google existe pour l'instant.
pub const GOOGLE: &str = "google";

/// Usage d'un `state` OAuth : connexion (ou inscription), ou liaison au compte connecté.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OAuthPurpose {
    Login,
    Link,
}

impl OAuthPurpose {
    pub fn as_str(self) -> &'static str {
        match self {
            OAuthPurpose::Login => "login",
            OAuthPurpose::Link => "link",
        }
    }

    pub fn parse(value: &str) -> Result<Self, StoreError> {
        match value {
            "login" => Ok(OAuthPurpose::Login),
            "link" => Ok(OAuthPurpose::Link),
            other => Err(StoreError::Other(format!("usage OAuth inconnu : {other}"))),
        }
    }
}

/// Demande d'autorisation en cours, retrouvée par l'empreinte de son `state`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OAuthState {
    pub purpose: OAuthPurpose,
    /// Compte à lier (usage [`OAuthPurpose::Link`]).
    pub user_id: Option<Uuid>,
    /// Vérificateur PKCE, envoyé à Google lors de l'échange du code.
    pub code_verifier: String,
    /// Valeur attendue du claim `nonce` du jeton d'identité.
    pub nonce: String,
}

/// Secret TOTP d'un compte.
#[derive(Debug, Clone)]
pub struct TotpRecord {
    pub ciphertext: Vec<u8>,
    /// `false` tant que l'enrôlement n'est pas confirmé par un premier code.
    pub enabled: bool,
}

/// Méthodes de connexion d'un compte.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SecurityStatus {
    /// Le compte a un mot de passe choisi (pas seulement l'aléatoire d'une inscription Google).
    pub password_set: bool,
    pub google_linked: bool,
    pub totp_enabled: bool,
    pub recovery_codes_remaining: u32,
}

/// Résultat d'une déliaison.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unlink {
    Unlinked,
    NotLinked,
    /// Refusé : ce serait la dernière méthode de connexion du compte.
    LastMethod,
}

#[async_trait]
pub trait SecurityStore: Send + Sync {
    /// Compte une tentative pour `key_hash` ; `false` si `limit` tentatives ont déjà eu lieu
    /// dans la fenêtre `window` (la tentative n'est alors pas comptée).
    async fn allow_attempt(
        &self,
        key_hash: &str,
        limit: u32,
        window: Duration,
    ) -> Result<bool, StoreError>;

    /// Enregistre une demande d'autorisation valable `ttl`.
    async fn save_oauth_state(
        &self,
        state_hash: &str,
        state: &OAuthState,
        ttl: Duration,
    ) -> Result<(), StoreError>;

    /// Retire et renvoie la demande si elle existe et n'a pas expiré : un `state` ne sert qu'une
    /// fois, même en cas d'appels simultanés.
    async fn take_oauth_state(&self, state_hash: &str) -> Result<Option<OAuthState>, StoreError>;

    /// Compte lié à l'identité externe (`sub`).
    async fn find_user_by_identity(
        &self,
        provider: &str,
        subject: &str,
    ) -> Result<Option<UserRecord>, StoreError>;

    /// Crée, en une transaction, un compte à l'adresse vérifiée par le fournisseur (sans mot de
    /// passe choisi) et sa liaison. [`StoreError::UsernameTaken`], [`StoreError::EmailTaken`]
    /// ou [`StoreError::IdentityTaken`] selon la contrainte violée.
    async fn create_oauth_user(
        &self,
        username: &str,
        email: &str,
        password_hash: &str,
        provider: &str,
        subject: &str,
    ) -> Result<UserRecord, StoreError>;

    /// Lie l'identité au compte ; [`StoreError::IdentityTaken`] si elle est liée à un compte
    /// ou si le compte est déjà lié à ce fournisseur.
    async fn link_identity(
        &self,
        user_id: Uuid,
        provider: &str,
        subject: &str,
        email: Option<&str>,
    ) -> Result<(), StoreError>;

    /// Délie le fournisseur, sauf si le compte n'a pas d'autre méthode de connexion. Révoque
    /// les jetons de rafraîchissement du compte en cas de succès.
    async fn unlink_identity(&self, user_id: Uuid, provider: &str) -> Result<Unlink, StoreError>;

    async fn security_status(&self, user_id: Uuid) -> Result<SecurityStatus, StoreError>;

    async fn find_totp(&self, user_id: Uuid) -> Result<Option<TotpRecord>, StoreError>;

    /// Enregistre (ou remplace) un secret en attente de confirmation ; `false` si la double
    /// authentification est déjà active.
    async fn stage_totp(&self, user_id: Uuid, ciphertext: &[u8]) -> Result<bool, StoreError>;

    /// Active le secret en attente avec le pas `step` du code qui l'a confirmé, et enregistre
    /// les codes de récupération ; `false` si rien n'est en attente.
    async fn enable_totp(
        &self,
        user_id: Uuid,
        step: i64,
        recovery_hashes: &[String],
    ) -> Result<bool, StoreError>;

    /// Consomme le pas `step` : `false` s'il (ou un pas postérieur) a déjà servi (rejeu).
    async fn use_totp_step(&self, user_id: Uuid, step: i64) -> Result<bool, StoreError>;

    /// Consomme un code de récupération ; `false` s'il est inconnu ou déjà utilisé.
    async fn consume_recovery_code(
        &self,
        user_id: Uuid,
        code_hash: &str,
    ) -> Result<bool, StoreError>;

    /// Remplace tous les codes de récupération ; `false` si la double authentification n'est
    /// pas active.
    async fn replace_recovery_codes(
        &self,
        user_id: Uuid,
        recovery_hashes: &[String],
    ) -> Result<bool, StoreError>;

    /// Supprime le secret et les codes, et révoque les jetons de rafraîchissement ; `false` si
    /// la double authentification n'était pas active.
    async fn disable_totp(&self, user_id: Uuid) -> Result<bool, StoreError>;

    async fn create_mfa_challenge(
        &self,
        user_id: Uuid,
        token_hash: &str,
        ttl: Duration,
    ) -> Result<(), StoreError>;

    /// Compte une tentative sur le défi et renvoie son compte, s'il est valable (non expiré,
    /// non consommé, moins de `max_attempts` tentatives).
    async fn attempt_mfa_challenge(
        &self,
        token_hash: &str,
        max_attempts: u32,
    ) -> Result<Option<Uuid>, StoreError>;

    /// Consomme le défi ; `false` s'il l'était déjà (deux réussites simultanées).
    async fn consume_mfa_challenge(&self, token_hash: &str) -> Result<bool, StoreError>;

    /// Révoque tous les jetons de rafraîchissement du compte.
    async fn revoke_all_refresh_tokens(&self, user_id: Uuid) -> Result<(), StoreError>;
}
