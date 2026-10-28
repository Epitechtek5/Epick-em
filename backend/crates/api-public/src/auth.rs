//! Inscription, connexion, rafraîchissement et déconnexion.
//!
//! - Le jeton d'accès est un JWT HS256 de courte durée, sans état côté serveur ;
//! - le jeton de rafraîchissement est une chaîne aléatoire opaque, dont seule l'empreinte
//!   SHA-256 est stockée. Il est à usage unique : chaque rafraîchissement le remplace ;
//! - toutes les routes exigent un jeton d'accès `Authorization: Bearer` valide, sauf celles de
//!   `guard::route_policy` ; `/refresh` accepte un jeton expiré ;
//! - la déconnexion révoque le jeton de rafraîchissement. Le jeton d'accès reste valable
//!   jusqu'à son expiration (`ACCESS_TOKEN_TTL_SECS`).

use crate::config::AuthConfig;
use crate::error::{ApiError, ErrorResponse};
use crate::store::{AuthStore, Role, StoreError, UserRecord};
use actix_web::{HttpResponse, post, web};
use argon2::Argon2;
use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt::Write;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use utoipa::ToSchema;
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

pub const USERNAME_MIN: usize = 3;
pub const USERNAME_MAX: usize = 32;
pub const PASSWORD_MIN: usize = 8;
pub const PASSWORD_MAX: usize = 128;

#[derive(Clone)]
pub struct AppState {
    pub(crate) store: Arc<dyn AuthStore>,
    pub(crate) config: Arc<AuthConfig>,
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

/// Routes d'authentification, avec leur documentation OpenAPI.
pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(register)
        .service(login)
        .service(refresh)
        .service(logout);
}

#[derive(Deserialize, ToSchema)]
struct Credentials {
    #[schema(min_length = 3, max_length = 32, example = "alice")]
    username: String,
    #[schema(min_length = 8, max_length = 128, format = Password)]
    password: String,
}

#[derive(Deserialize, ToSchema)]
struct RefreshRequest {
    refresh_token: String,
}

#[derive(Serialize, ToSchema)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    #[schema(example = "Bearer")]
    token_type: &'static str,
    /// Durée de validité du jeton d'accès, en secondes.
    expires_in: u64,
}

/// Contenu du jeton d'accès.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// Identifiant du compte.
    pub sub: Uuid,
    pub username: String,
    pub role: Role,
    pub iat: u64,
    pub exp: u64,
}

/// Vérifie la signature et l'expiration d'un jeton d'accès.
pub fn decode_access_token(token: &str, secret: &str) -> Option<Claims> {
    decode_claims(token, secret, true)
}

/// Vérifie seulement la signature : un jeton expiré est accepté (route `/refresh`).
pub fn decode_access_token_ignoring_expiry(token: &str, secret: &str) -> Option<Claims> {
    decode_claims(token, secret, false)
}

fn decode_claims(token: &str, secret: &str, check_expiry: bool) -> Option<Claims> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.leeway = 0;
    validation.validate_exp = check_expiry;
    jsonwebtoken::decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .ok()
    .map(|data| data.claims)
}

/// Crée un compte et renvoie directement les jetons, comme `/login`.
#[utoipa::path(
    post,
    path = "/register",
    tag = "auth",
    request_body = Credentials,
    responses(
        (status = 201, description = "Compte créé, jetons émis", body = TokenResponse),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 409, description = "Nom d'utilisateur déjà pris", body = ErrorResponse),
    ),
)]
#[post("/register")]
async fn register(
    state: web::Data<AppState>,
    credentials: web::Json<Credentials>,
) -> Result<HttpResponse, ApiError> {
    let credentials = credentials.into_inner();
    validate_registration(&credentials)?;

    let password_hash = hash_password_blocking(credentials.password).await?;
    let user = state
        .store
        .create_user(&credentials.username, &password_hash)
        .await
        .map_err(|err| match err {
            StoreError::UsernameTaken => ApiError::Conflict,
            other => ApiError::internal(other),
        })?;
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
    Ok(HttpResponse::Created().json(token_response(&state.config, &user, refresh_token)?))
}

/// Échange des identifiants contre un jeton d'accès et un jeton de rafraîchissement.
#[utoipa::path(
    post,
    path = "/login",
    tag = "auth",
    request_body = Credentials,
    responses(
        (status = 200, description = "Jetons émis", body = TokenResponse),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Identifiants refusés", body = ErrorResponse),
    ),
)]
#[post("/login")]
async fn login(
    state: web::Data<AppState>,
    credentials: web::Json<Credentials>,
) -> Result<HttpResponse, ApiError> {
    let credentials = credentials.into_inner();
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
    let verified = web::block(move || verify_password(&password, &hash))
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
            Ok(HttpResponse::Ok().json(token_response(&state.config, &user, refresh_token)?))
        }
        _ => Err(ApiError::Unauthorized),
    }
}

/// Le jeton de rafraîchissement doit appartenir au compte du jeton d'accès (éventuellement
/// expiré), vérifié par le middleware.
#[utoipa::path(
    post,
    path = "/refresh",
    tag = "auth",
    security(("bearer" = [])),
    request_body = RefreshRequest,
    responses(
        (status = 200, description = "Nouveaux jetons ; l'ancien jeton de rafraîchissement est invalidé", body = TokenResponse),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès ou de rafraîchissement refusé", body = ErrorResponse),
    ),
)]
#[post("/refresh")]
async fn refresh(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    request: web::Json<RefreshRequest>,
) -> Result<HttpResponse, ApiError> {
    let new_token = new_refresh_token();
    let rotated = state
        .store
        .rotate_refresh_token(
            claims.sub,
            &hash_token(&request.refresh_token),
            &hash_token(&new_token),
            state.config.refresh_token_ttl,
        )
        .await
        .map_err(ApiError::internal)?;
    if !rotated {
        return Err(ApiError::Unauthorized);
    }
    let user = state
        .store
        .find_user_by_id(claims.sub)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::Unauthorized)?;
    Ok(HttpResponse::Ok().json(token_response(&state.config, &user, new_token)?))
}

/// Idempotent : répond 204 même si le jeton est inconnu, déjà révoqué ou appartient à un
/// autre compte (dans ce cas il n'est pas révoqué).
#[utoipa::path(
    post,
    path = "/logout",
    tag = "auth",
    security(("bearer" = [])),
    request_body = RefreshRequest,
    responses(
        (status = 204, description = "Jeton de rafraîchissement révoqué"),
        (status = 400, description = "Requête invalide", body = ErrorResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
    ),
)]
#[post("/logout")]
async fn logout(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    request: web::Json<RefreshRequest>,
) -> Result<HttpResponse, ApiError> {
    state
        .store
        .revoke_refresh_token(claims.sub, &hash_token(&request.refresh_token))
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::NoContent().finish())
}

fn validate_registration(credentials: &Credentials) -> Result<(), ApiError> {
    let mut errors = Vec::new();
    if let Some(message) = username_error(&credentials.username) {
        errors.push(("username", message));
    }
    if let Some(message) = password_error(&credentials.password) {
        errors.push(("password", message));
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(ApiError::Validation(errors))
    }
}

/// Message d'erreur si `username` n'est pas un nom d'utilisateur valide.
pub(crate) fn username_error(username: &str) -> Option<String> {
    let len = username.chars().count();
    if !(USERNAME_MIN..=USERNAME_MAX).contains(&len) {
        Some(format!(
            "Le nom d'utilisateur doit contenir entre {USERNAME_MIN} et {USERNAME_MAX} caractères."
        ))
    } else if !username
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
    {
        Some("Utilisez uniquement des lettres, des chiffres, « _ », « . » ou « - ».".to_string())
    } else {
        None
    }
}

/// Message d'erreur si `password` n'est pas un mot de passe valide.
pub(crate) fn password_error(password: &str) -> Option<String> {
    let len = password.chars().count();
    (!(PASSWORD_MIN..=PASSWORD_MAX).contains(&len)).then(|| {
        format!("Le mot de passe doit contenir entre {PASSWORD_MIN} et {PASSWORD_MAX} caractères.")
    })
}

/// Hache un mot de passe sans bloquer un worker HTTP (Argon2 est volontairement coûteux).
pub(crate) async fn hash_password_blocking(password: String) -> Result<String, ApiError> {
    web::block(move || hash_password(&password))
        .await
        .map_err(ApiError::internal)?
        .map_err(ApiError::internal)
}

fn token_response(
    config: &AuthConfig,
    user: &UserRecord,
    refresh_token: String,
) -> Result<TokenResponse, ApiError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(ApiError::internal)?
        .as_secs();
    let claims = Claims {
        sub: user.id,
        username: user.username.clone(),
        role: user.role,
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
        let user = UserRecord {
            id,
            username: "alice".into(),
            password_hash: String::new(),
            role: Role::Admin,
        };
        let response = token_response(&config, &user, "r".into()).unwrap();
        let claims = decode_access_token(&response.access_token, secret).unwrap();
        assert_eq!(claims.sub, id);
        assert_eq!(claims.username, "alice");
        assert_eq!(claims.role, Role::Admin);
        assert_eq!(claims.exp - claims.iat, 60);
        assert!(
            decode_access_token(&response.access_token, "autre-secret-autre-secret-autre")
                .is_none()
        );
    }
}
