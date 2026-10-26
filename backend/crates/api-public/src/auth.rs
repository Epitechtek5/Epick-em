//! Inscription, connexion, rafraîchissement et déconnexion.
//!
//! - Le jeton d'accès est un JWT HS256 de courte durée, sans état côté serveur ;
//! - le jeton de rafraîchissement est une chaîne aléatoire opaque, dont seule l'empreinte
//!   SHA-256 est stockée. Il est à usage unique : chaque rafraîchissement le remplace ;
//! - la déconnexion révoque le jeton de rafraîchissement. Le jeton d'accès reste valable
//!   jusqu'à son expiration (`ACCESS_TOKEN_TTL_SECS`).

use crate::config::AuthConfig;
use crate::error::ApiError;
use crate::store::{AuthStore, StoreError};
use argon2::Argon2;
use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use axum::extract::State;
use axum::extract::rejection::JsonRejection;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt::Write;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub const USERNAME_MIN: usize = 3;
pub const USERNAME_MAX: usize = 32;
pub const PASSWORD_MIN: usize = 8;
pub const PASSWORD_MAX: usize = 128;

#[derive(Clone)]
pub struct AppState {
    store: Arc<dyn AuthStore>,
    config: Arc<AuthConfig>,
    /// Empreinte factice, vérifiée quand le compte n'existe pas pour que « compte inconnu »
    /// et « mauvais mot de passe » prennent le même temps.
    dummy_hash: Arc<str>,
}

impl AppState {
    pub fn new(
        store: Arc<dyn AuthStore>,
        config: AuthConfig,
    ) -> Result<Self, argon2::password_hash::Error> {
        let dummy_hash = hash_password("mot de passe factice")?;
        Ok(AppState {
            store,
            config: Arc::new(config),
            dummy_hash: dummy_hash.into(),
        })
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/refresh", post(refresh))
        .route("/logout", post(logout))
        .with_state(state)
}

#[derive(Deserialize)]
struct Credentials {
    username: String,
    password: String,
}

#[derive(Deserialize)]
struct RefreshRequest {
    refresh_token: String,
}

#[derive(Serialize)]
struct RegisterResponse {
    id: Uuid,
    username: String,
}

#[derive(Serialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    token_type: &'static str,
    /// Durée de validité du jeton d'accès, en secondes.
    expires_in: u64,
}

/// Contenu du jeton d'accès.
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    /// Identifiant du compte.
    pub sub: Uuid,
    pub username: String,
    pub iat: u64,
    pub exp: u64,
}

/// Vérifie la signature et l'expiration d'un jeton d'accès.
pub fn decode_access_token(token: &str, secret: &str) -> Option<Claims> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.leeway = 0;
    jsonwebtoken::decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .ok()
    .map(|data| data.claims)
}

async fn register(
    State(state): State<AppState>,
    body: Result<Json<Credentials>, JsonRejection>,
) -> Result<(StatusCode, Json<RegisterResponse>), ApiError> {
    let Json(credentials) = body?;
    validate_registration(&credentials)?;

    let password = credentials.password;
    let password_hash = tokio::task::spawn_blocking(move || hash_password(&password))
        .await
        .map_err(ApiError::internal)?
        .map_err(ApiError::internal)?;
    let user = state
        .store
        .create_user(&credentials.username, &password_hash)
        .await
        .map_err(|err| match err {
            StoreError::UsernameTaken => ApiError::Conflict,
            other => ApiError::internal(other),
        })?;
    Ok((
        StatusCode::CREATED,
        Json(RegisterResponse {
            id: user.id,
            username: user.username,
        }),
    ))
}

async fn login(
    State(state): State<AppState>,
    body: Result<Json<Credentials>, JsonRejection>,
) -> Result<Json<TokenResponse>, ApiError> {
    let Json(credentials) = body?;
    let mut missing = Vec::new();
    if credentials.username.is_empty() {
        missing.push(("username", "Saisissez votre nom d'utilisateur.".to_string()));
    }
    if credentials.password.is_empty() {
        missing.push(("password", "Saisissez votre mot de passe.".to_string()));
    }
    if !missing.is_empty() {
        return Err(ApiError::Validation(missing));
    }
    // Aucun compte n'a un mot de passe aussi long : inutile de payer un hachage.
    if credentials.password.chars().count() > PASSWORD_MAX {
        return Err(ApiError::Unauthorized);
    }

    let user = state
        .store
        .find_user_by_username(&credentials.username)
        .await
        .map_err(ApiError::internal)?;
    let hash = user
        .as_ref()
        .map_or_else(|| state.dummy_hash.to_string(), |u| u.password_hash.clone());
    let password = credentials.password;
    let verified = tokio::task::spawn_blocking(move || verify_password(&password, &hash))
        .await
        .map_err(ApiError::internal)?;
    match user {
        Some(user) if verified => {
            let refresh_token = new_refresh_token();
            state
                .store
                .insert_refresh_token(
                    user.id,
                    &hash_token(&refresh_token),
                    state.config.refresh_token_ttl,
                )
                .await
                .map_err(ApiError::internal)?;
            token_response(&state.config, user.id, &user.username, refresh_token).map(Json)
        }
        _ => Err(ApiError::Unauthorized),
    }
}

async fn refresh(
    State(state): State<AppState>,
    body: Result<Json<RefreshRequest>, JsonRejection>,
) -> Result<Json<TokenResponse>, ApiError> {
    let Json(request) = body?;
    let new_token = new_refresh_token();
    let user_id = state
        .store
        .rotate_refresh_token(
            &hash_token(&request.refresh_token),
            &hash_token(&new_token),
            state.config.refresh_token_ttl,
        )
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::Unauthorized)?;
    let user = state
        .store
        .find_user_by_id(user_id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::Unauthorized)?;
    token_response(&state.config, user.id, &user.username, new_token).map(Json)
}

/// Idempotent : répond 204 même si le jeton est inconnu ou déjà révoqué.
async fn logout(
    State(state): State<AppState>,
    body: Result<Json<RefreshRequest>, JsonRejection>,
) -> Result<StatusCode, ApiError> {
    let Json(request) = body?;
    state
        .store
        .revoke_refresh_token(&hash_token(&request.refresh_token))
        .await
        .map_err(ApiError::internal)?;
    Ok(StatusCode::NO_CONTENT)
}

fn validate_registration(credentials: &Credentials) -> Result<(), ApiError> {
    let mut errors = Vec::new();
    let username_len = credentials.username.chars().count();
    if !(USERNAME_MIN..=USERNAME_MAX).contains(&username_len) {
        errors.push((
            "username",
            format!("Le nom d'utilisateur doit contenir entre {USERNAME_MIN} et {USERNAME_MAX} caractères."),
        ));
    } else if !credentials
        .username
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
    {
        errors.push((
            "username",
            "Utilisez uniquement des lettres, des chiffres, « _ », « . » ou « - ».".to_string(),
        ));
    }
    let password_len = credentials.password.chars().count();
    if !(PASSWORD_MIN..=PASSWORD_MAX).contains(&password_len) {
        errors.push((
            "password",
            format!(
                "Le mot de passe doit contenir entre {PASSWORD_MIN} et {PASSWORD_MAX} caractères."
            ),
        ));
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(ApiError::Validation(errors))
    }
}

fn token_response(
    config: &AuthConfig,
    user_id: Uuid,
    username: &str,
    refresh_token: String,
) -> Result<TokenResponse, ApiError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(ApiError::internal)?
        .as_secs();
    let claims = Claims {
        sub: user_id,
        username: username.to_string(),
        iat: now,
        exp: now + config.access_token_ttl.as_secs(),
    };
    let access_token = jsonwebtoken::encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(ApiError::internal)?;
    Ok(TokenResponse {
        access_token,
        refresh_token,
        token_type: "Bearer",
        expires_in: config.access_token_ttl.as_secs(),
    })
}

fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
}

fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .and_then(|parsed| Argon2::default().verify_password(password.as_bytes(), &parsed))
        .is_ok()
}

/// 256 bits d'aléa, en hexadécimal.
fn new_refresh_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    hex(&bytes)
}

/// Empreinte stockée en base : une fuite de la table ne donne pas de jeton utilisable.
fn hash_token(token: &str) -> String {
    hex(&Sha256::digest(token.as_bytes()))
}

fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut out, b| {
            let _ = write!(out, "{b:02x}");
            out
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_hash_round_trip() {
        let hash = hash_password("secret123").unwrap();
        assert!(verify_password("secret123", &hash));
        assert!(!verify_password("secret124", &hash));
        assert!(!verify_password("secret123", "pas un hash"));
    }

    #[test]
    fn refresh_tokens_are_random_and_hashed_deterministically() {
        let (a, b) = (new_refresh_token(), new_refresh_token());
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
        assert_eq!(hash_token(&a), hash_token(&a));
        assert_ne!(hash_token(&a), a);
        assert_eq!(hash_token("abc").len(), 64);
    }

    #[test]
    fn access_token_round_trip() {
        let secret = "s".repeat(32);
        let secret = secret.as_str();
        let config = AuthConfig {
            jwt_secret: secret.into(),
            access_token_ttl: std::time::Duration::from_secs(60),
            refresh_token_ttl: std::time::Duration::from_secs(120),
        };
        let id = Uuid::new_v4();
        let response = token_response(&config, id, "alice", "r".into()).unwrap();
        let claims = decode_access_token(&response.access_token, secret).unwrap();
        assert_eq!(claims.sub, id);
        assert_eq!(claims.username, "alice");
        assert_eq!(claims.exp - claims.iat, 60);
        assert!(
            decode_access_token(&response.access_token, "autre-secret-autre-secret-autre")
                .is_none()
        );
    }
}
