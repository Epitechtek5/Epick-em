//! Connexion Google et double authentification (TOTP).
//!
//! **Google** (OpenID Connect, code d'autorisation + PKCE, voir [`crate::google`]) :
//! - `POST /auth/google/authorize` puis `POST /auth/google/callback` connectent le compte lié à
//!   l'identité Google (`sub`), ou en créent un : adresse vérifiée par Google, nom
//!   d'utilisateur unique déduit de l'adresse, mot de passe aléatoire (256 bits) haché en
//!   Argon2id et jamais révélé. Un mot de passe réel se choisit ensuite avec
//!   `/forgot-password` ;
//! - un compte existant n'est **jamais** fusionné sur la seule adresse e-mail : si l'adresse est
//!   prise, la réponse est `409 account_exists` et l'utilisateur lie Google depuis son compte
//!   (`/account/google/authorize` puis `/account/google/link`), authentifié récemment ;
//! - la déliaison est refusée si Google est la dernière méthode de connexion du compte.
//!
//! **Double authentification** :
//! - `/2fa/setup` génère un secret (chiffré en base), activé seulement par `/2fa/enable` avec un
//!   premier code valide, qui renvoie les codes de récupération (affichés une seule fois) ;
//! - le mot de passe comme Google n'émettent alors qu'un défi : les jetons ne sont émis qu'après
//!   `/login/2fa` avec un code TOTP ou un code de récupération (usage unique) ;
//! - désactiver, régénérer les codes, lier ou délier Google exigent une authentification de
//!   moins de [`REAUTH_WINDOW_SECS`] secondes et, si elle est active, un code de second facteur.
//!
//! **Protection** : tentatives limitées par adresse IP (Google) et par compte (codes) ; défi à
//! usage unique limité à [`MFA_MAX_ATTEMPTS`] essais ; pas TOTP déjà utilisé refusé (rejeu) ;
//! désactiver la double authentification ou délier Google révoque les jetons de
//! rafraîchissement du compte.

use crate::auth::{
    AppState, Claims, LoginResponse, TokenResponse, USERNAME_MIN, begin_session, hash_password,
    hash_token, issue_tokens, new_token, now_secs, username_error,
};
use crate::error::{ApiError, ErrorResponse};
use crate::google::{GoogleAuth, Identity, OidcError};
use crate::password_reset::normalize_email;
use crate::store::{GOOGLE, OAuthPurpose, OAuthState, StoreError, Unlink, UserRecord};
use crate::totp::{self, TotpKey};
use actix_web::{HttpRequest, HttpResponse, get, post, web};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use utoipa::ToSchema;
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

/// Âge maximal de l'authentification pour une action sensible.
pub const REAUTH_WINDOW_SECS: u64 = 10 * 60;
/// Durée de validité d'une demande d'autorisation Google.
pub const OAUTH_STATE_TTL: Duration = Duration::from_secs(10 * 60);
/// Essais par défi de second facteur.
pub const MFA_MAX_ATTEMPTS: u32 = 5;
/// Codes de second facteur vérifiables par compte et par fenêtre.
const CODE_ATTEMPTS: u32 = 10;
/// Demandes Google par adresse IP et par fenêtre.
const OAUTH_ATTEMPTS: u32 = 30;
const ATTEMPT_WINDOW: Duration = Duration::from_secs(15 * 60);
/// Essais de génération d'un nom d'utilisateur libre pour un compte Google.
const USERNAME_TRIES: usize = 5;

pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(google_authorize)
        .service(google_callback)
        .service(login_second_factor)
        .service(account_security)
        .service(link_authorize)
        .service(link_google)
        .service(unlink_google)
        .service(setup_totp)
        .service(enable_totp)
        .service(disable_totp)
        .service(regenerate_recovery_codes);
}

#[derive(Deserialize, ToSchema)]
struct OAuthCallback {
    /// Paramètre `code` reçu sur l'URL de retour.
    code: String,
    /// Paramètre `state` reçu sur l'URL de retour.
    state: String,
}

#[derive(Deserialize, ToSchema)]
struct LinkRequest {
    code: String,
    state: String,
    /// Code TOTP ou de récupération, exigé si la double authentification est active.
    #[serde(default)]
    second_factor: Option<String>,
}

#[derive(Deserialize, ToSchema)]
struct SecondFactor {
    /// Code TOTP à 6 chiffres, ou code de récupération.
    #[serde(default)]
    code: Option<String>,
}

#[derive(Deserialize, ToSchema)]
struct MfaLogin {
    /// Jeton renvoyé par `/login` ou `/auth/google/callback`.
    mfa_token: String,
    /// Code TOTP à 6 chiffres, ou code de récupération.
    code: String,
}

#[derive(Serialize, ToSchema)]
struct AuthorizationResponse {
    /// URL Google vers laquelle rediriger le navigateur.
    authorization_url: String,
    /// À comparer au `state` reçu sur l'URL de retour, puis à renvoyer au serveur.
    state: String,
}

#[derive(Serialize, ToSchema)]
struct SecurityResponse {
    /// Le compte a un mot de passe choisi (sinon : `/forgot-password` pour en définir un).
    password_set: bool,
    google_linked: bool,
    two_factor_enabled: bool,
    recovery_codes_remaining: u32,
    google_available: bool,
    two_factor_available: bool,
}

#[derive(Serialize, ToSchema)]
struct TotpSetupResponse {
    /// Secret en base32, à saisir à la main si le QR code ne peut pas être lu.
    secret: String,
    /// URI `otpauth://` à afficher en QR code.
    otpauth_uri: String,
}

#[derive(Serialize, ToSchema)]
struct RecoveryCodesResponse {
    /// Codes à usage unique, affichés une seule fois.
    recovery_codes: Vec<String>,
}

fn google(state: &AppState) -> Result<&GoogleAuth, ApiError> {
    state.google.as_deref().ok_or(ApiError::NotConfigured)
}

fn totp_key(state: &AppState) -> Result<&TotpKey, ApiError> {
    state.totp_key.as_ref().ok_or(ApiError::NotConfigured)
}

fn require_recent(claims: &Claims) -> Result<(), ApiError> {
    if now_secs().saturating_sub(claims.auth_time) <= REAUTH_WINDOW_SECS {
        Ok(())
    } else {
        Err(ApiError::ReauthenticationRequired)
    }
}

/// Compte une tentative pour `key` ; `429` au-delà de `limit` par fenêtre.
async fn limit(state: &AppState, key: &str, limit: u32) -> Result<(), ApiError> {
    if state
        .store
        .allow_attempt(&hash_token(key), limit, ATTEMPT_WINDOW)
        .await
        .map_err(ApiError::internal)?
    {
        Ok(())
    } else {
        Err(ApiError::TooManyAttempts)
    }
}

async fn limit_peer(state: &AppState, http: &HttpRequest) -> Result<(), ApiError> {
    let peer = http
        .peer_addr()
        .map_or_else(|| "inconnu".to_string(), |addr| addr.ip().to_string());
    limit(state, &format!("oauth:{peer}"), OAUTH_ATTEMPTS).await
}

fn oidc_error(err: OidcError) -> ApiError {
    match err {
        OidcError::Provider(detail) => {
            eprintln!("api-public : connexion Google : {detail}");
            ApiError::ProviderUnavailable
        }
        OidcError::InvalidToken(_) => ApiError::Unauthorized,
    }
}

/// Crée et enregistre une demande d'autorisation.
async fn authorization(
    state: &AppState,
    purpose: OAuthPurpose,
    user_id: Option<Uuid>,
) -> Result<AuthorizationResponse, ApiError> {
    let google = google(state)?;
    let (oauth_state, nonce, code_verifier) = (new_token(), new_token(), new_token());
    state
        .store
        .save_oauth_state(
            &hash_token(&oauth_state),
            &OAuthState {
                purpose,
                user_id,
                code_verifier: code_verifier.clone(),
                nonce: nonce.clone(),
            },
            OAUTH_STATE_TTL,
        )
        .await
        .map_err(ApiError::internal)?;
    Ok(AuthorizationResponse {
        authorization_url: google.authorization_url(&oauth_state, &nonce, &code_verifier),
        state: oauth_state,
    })
}

/// Retire la demande et authentifie le code auprès de Google.
async fn complete(
    state: &AppState,
    code: &str,
    oauth_state: &str,
    purpose: OAuthPurpose,
    user_id: Option<Uuid>,
) -> Result<Identity, ApiError> {
    let google = google(state)?;
    let saved = state
        .store
        .take_oauth_state(&hash_token(oauth_state))
        .await
        .map_err(ApiError::internal)?
        .filter(|saved| saved.purpose == purpose && saved.user_id == user_id)
        .ok_or(ApiError::InvalidOAuthState)?;
    google
        .authenticate(code, &saved.code_verifier, &saved.nonce)
        .await
        .map_err(oidc_error)
}

/// Nom d'utilisateur valide déduit de l'adresse ; un suffixe aléatoire à partir du 2e essai.
fn candidate_username(email: &str, attempt: usize) -> String {
    let local = email.split('@').next().unwrap_or_default();
    let mut base: String = local
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
        .take(24)
        .collect();
    if base.chars().count() < USERNAME_MIN {
        base = format!("joueur{base}");
    }
    if attempt == 0 {
        base
    } else {
        format!("{base}-{}", &new_token()[..6])
    }
}

/// Crée le compte d'une identité Google inconnue ; `None` si une requête simultanée l'a créé.
async fn create_google_user(
    state: &AppState,
    identity: &Identity,
    email: &str,
) -> Result<Option<UserRecord>, ApiError> {
    // Mot de passe aléatoire : le compte a une empreinte Argon2id valide, que personne ne
    // connaît. La valeur en clair n'existe qu'ici, le temps du hachage.
    let password_hash = web::block(|| hash_password(&new_token()))
        .await
        .map_err(ApiError::internal)?
        .map_err(ApiError::internal)?;
    for attempt in 0..USERNAME_TRIES {
        let username = candidate_username(email, attempt);
        debug_assert!(username_error(&username).is_none(), "{username}");
        match state
            .store
            .create_oauth_user(&username, email, &password_hash, GOOGLE, &identity.subject)
            .await
        {
            Ok(user) => return Ok(Some(user)),
            Err(StoreError::UsernameTaken) => continue,
            Err(StoreError::EmailTaken) => return Err(ApiError::AccountExists),
            Err(StoreError::IdentityTaken) => return Ok(None),
            Err(other) => return Err(ApiError::internal(other)),
        }
    }
    Err(ApiError::internal("aucun nom d'utilisateur libre"))
}

/// Démarre une connexion (ou une inscription) avec Google.
#[utoipa::path(
    post,
    path = "/auth/google/authorize",
    tag = "auth",
    responses(
        (status = 200, description = "URL d'autorisation Google", body = AuthorizationResponse),
        (status = 429, description = "Trop de demandes", body = ErrorResponse),
        (status = 503, description = "Connexion Google non configurée", body = ErrorResponse),
    ),
)]
#[post("/auth/google/authorize")]
async fn google_authorize(
    state: web::Data<AppState>,
    http: HttpRequest,
) -> Result<HttpResponse, ApiError> {
    google(&state)?;
    limit_peer(&state, &http).await?;
    let response = authorization(&state, OAuthPurpose::Login, None).await?;
    Ok(HttpResponse::Ok().json(response))
}

/// Termine la connexion Google : jetons (ou défi de second facteur), en créant le compte si
/// l'identité Google est inconnue.
#[utoipa::path(
    post,
    path = "/auth/google/callback",
    tag = "auth",
    request_body = OAuthCallback,
    responses(
        (status = 200, description = "Jetons émis, ou défi de second facteur", body = LoginResponse),
        (status = 400, description = "`state` inconnu, expiré ou déjà utilisé", body = ErrorResponse),
        (status = 401, description = "Jeton d'identité Google refusé", body = ErrorResponse),
        (status = 403, description = "Adresse du compte Google non vérifiée", body = ErrorResponse),
        (status = 409, description = "Un compte utilise déjà cette adresse : lier Google depuis ce compte", body = ErrorResponse),
        (status = 429, description = "Trop de demandes", body = ErrorResponse),
        (status = 502, description = "Google injoignable", body = ErrorResponse),
        (status = 503, description = "Connexion Google non configurée", body = ErrorResponse),
    ),
)]
#[post("/auth/google/callback")]
async fn google_callback(
    state: web::Data<AppState>,
    http: HttpRequest,
    request: web::Json<OAuthCallback>,
) -> Result<HttpResponse, ApiError> {
    google(&state)?;
    limit_peer(&state, &http).await?;
    let identity = complete(
        &state,
        &request.code,
        &request.state,
        OAuthPurpose::Login,
        None,
    )
    .await?;
    let find = || state.store.find_user_by_identity(GOOGLE, &identity.subject);
    let user = match find().await.map_err(ApiError::internal)? {
        Some(user) => user,
        None => {
            let email = identity
                .email
                .as_deref()
                .filter(|_| identity.email_verified)
                .map(normalize_email)
                .ok_or(ApiError::ProviderEmailUnverified)?;
            match create_google_user(&state, &identity, &email).await? {
                Some(user) => user,
                None => find()
                    .await
                    .map_err(ApiError::internal)?
                    .ok_or_else(|| ApiError::internal("identité Google introuvable"))?,
            }
        }
    };
    Ok(HttpResponse::Ok().json(begin_session(&state, &user).await?))
}

/// Termine une connexion avec un code TOTP ou un code de récupération.
#[utoipa::path(
    post,
    path = "/login/2fa",
    tag = "auth",
    request_body = MfaLogin,
    responses(
        (status = 200, description = "Jetons émis", body = TokenResponse),
        (status = 401, description = "Défi inconnu, expiré ou épuisé, ou code refusé", body = ErrorResponse),
        (status = 429, description = "Trop de tentatives", body = ErrorResponse),
        (status = 503, description = "Double authentification non configurée", body = ErrorResponse),
    ),
)]
#[post("/login/2fa")]
async fn login_second_factor(
    state: web::Data<AppState>,
    request: web::Json<MfaLogin>,
) -> Result<HttpResponse, ApiError> {
    let challenge = hash_token(&request.mfa_token);
    let user_id = state
        .store
        .attempt_mfa_challenge(&challenge, MFA_MAX_ATTEMPTS)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::Unauthorized)?;
    if !check_second_factor(&state, user_id, &request.code).await? {
        return Err(ApiError::InvalidSecondFactor);
    }
    // Deux requêtes simultanées avec des codes valides : une seule obtient les jetons.
    if !state
        .store
        .consume_mfa_challenge(&challenge)
        .await
        .map_err(ApiError::internal)?
    {
        return Err(ApiError::Unauthorized);
    }
    let user = state
        .store
        .find_user_by_id(user_id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::Unauthorized)?;
    Ok(HttpResponse::Ok().json(issue_tokens(&state, &user).await?))
}

/// Vérifie un code TOTP (pas non encore utilisé) ou consomme un code de récupération.
async fn check_second_factor(
    state: &AppState,
    user_id: Uuid,
    code: &str,
) -> Result<bool, ApiError> {
    let key = totp_key(state)?;
    limit(state, &format!("2fa:{user_id}"), CODE_ATTEMPTS).await?;
    if !totp::looks_like_totp(code) {
        let normalized = totp::normalize_recovery_code(code);
        if normalized.is_empty() || normalized.len() > 64 {
            return Ok(false);
        }
        return state
            .store
            .consume_recovery_code(user_id, &hash_token(&normalized))
            .await
            .map_err(ApiError::internal);
    }
    let Some(record) = state
        .store
        .find_totp(user_id)
        .await
        .map_err(ApiError::internal)?
        .filter(|record| record.enabled)
    else {
        return Ok(false);
    };
    let secret = key
        .decrypt(user_id, &record.ciphertext)
        .ok_or_else(|| ApiError::internal("secret TOTP indéchiffrable"))?;
    match totp::verify(&secret, code, now_secs()) {
        Some(step) => state
            .store
            .use_totp_step(user_id, step)
            .await
            .map_err(ApiError::internal),
        None => Ok(false),
    }
}

/// Exige un second facteur valide si la double authentification est active.
async fn confirm_second_factor(
    state: &AppState,
    user_id: Uuid,
    code: Option<&str>,
) -> Result<(), ApiError> {
    let status = state
        .store
        .security_status(user_id)
        .await
        .map_err(ApiError::internal)?;
    if !status.totp_enabled {
        return Ok(());
    }
    let code = code.ok_or(ApiError::InvalidSecondFactor)?;
    if check_second_factor(state, user_id, code).await? {
        Ok(())
    } else {
        Err(ApiError::InvalidSecondFactor)
    }
}

fn hashes(codes: &[String]) -> Vec<String> {
    codes
        .iter()
        .map(|code| hash_token(&totp::normalize_recovery_code(code)))
        .collect()
}

/// Méthodes de connexion du compte courant.
#[utoipa::path(
    get,
    path = "/account/security",
    tag = "auth",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Méthodes de connexion", body = SecurityResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
    ),
)]
#[get("/account/security")]
async fn account_security(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
) -> Result<HttpResponse, ApiError> {
    let status = state
        .store
        .security_status(claims.sub)
        .await
        .map_err(ApiError::internal)?;
    Ok(HttpResponse::Ok().json(SecurityResponse {
        password_set: status.password_set,
        google_linked: status.google_linked,
        two_factor_enabled: status.totp_enabled,
        recovery_codes_remaining: status.recovery_codes_remaining,
        google_available: state.google.is_some(),
        two_factor_available: state.totp_key.is_some(),
    }))
}

/// Démarre la liaison d'un compte Google au compte courant.
#[utoipa::path(
    post,
    path = "/account/google/authorize",
    tag = "auth",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "URL d'autorisation Google", body = AuthorizationResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Authentification trop ancienne", body = ErrorResponse),
        (status = 503, description = "Connexion Google non configurée", body = ErrorResponse),
    ),
)]
#[post("/account/google/authorize")]
async fn link_authorize(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
) -> Result<HttpResponse, ApiError> {
    google(&state)?;
    require_recent(&claims)?;
    let response = authorization(&state, OAuthPurpose::Link, Some(claims.sub)).await?;
    Ok(HttpResponse::Ok().json(response))
}

/// Lie le compte Google au compte courant.
#[utoipa::path(
    post,
    path = "/account/google/link",
    tag = "auth",
    security(("bearer" = [])),
    request_body = LinkRequest,
    responses(
        (status = 204, description = "Compte Google lié"),
        (status = 400, description = "`state` inconnu, expiré, déjà utilisé ou d'un autre compte", body = ErrorResponse),
        (status = 401, description = "Jeton refusé, ou code de second facteur refusé", body = ErrorResponse),
        (status = 403, description = "Authentification trop ancienne", body = ErrorResponse),
        (status = 409, description = "Compte Google déjà lié", body = ErrorResponse),
        (status = 502, description = "Google injoignable", body = ErrorResponse),
        (status = 503, description = "Connexion Google non configurée", body = ErrorResponse),
    ),
)]
#[post("/account/google/link")]
async fn link_google(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    request: web::Json<LinkRequest>,
) -> Result<HttpResponse, ApiError> {
    google(&state)?;
    require_recent(&claims)?;
    confirm_second_factor(&state, claims.sub, request.second_factor.as_deref()).await?;
    let identity = complete(
        &state,
        &request.code,
        &request.state,
        OAuthPurpose::Link,
        Some(claims.sub),
    )
    .await?;
    let email = identity.email.as_deref().map(normalize_email);
    state
        .store
        .link_identity(claims.sub, GOOGLE, &identity.subject, email.as_deref())
        .await
        .map_err(|err| match err {
            StoreError::IdentityTaken => ApiError::IdentityTaken,
            other => ApiError::internal(other),
        })?;
    Ok(HttpResponse::NoContent().finish())
}

/// Délie le compte Google ; refusé si c'est la dernière méthode de connexion. Révoque les
/// jetons de rafraîchissement du compte.
#[utoipa::path(
    post,
    path = "/account/google/unlink",
    tag = "auth",
    security(("bearer" = [])),
    request_body = SecondFactor,
    responses(
        (status = 204, description = "Compte Google délié"),
        (status = 401, description = "Jeton refusé, ou code de second facteur refusé", body = ErrorResponse),
        (status = 403, description = "Authentification trop ancienne", body = ErrorResponse),
        (status = 404, description = "Aucun compte Google lié", body = ErrorResponse),
        (status = 409, description = "Dernière méthode de connexion", body = ErrorResponse),
    ),
)]
#[post("/account/google/unlink")]
async fn unlink_google(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    request: web::Json<SecondFactor>,
) -> Result<HttpResponse, ApiError> {
    require_recent(&claims)?;
    confirm_second_factor(&state, claims.sub, request.code.as_deref()).await?;
    match state
        .store
        .unlink_identity(claims.sub, GOOGLE)
        .await
        .map_err(ApiError::internal)?
    {
        Unlink::Unlinked => Ok(HttpResponse::NoContent().finish()),
        Unlink::NotLinked => Err(ApiError::NotFound),
        Unlink::LastMethod => Err(ApiError::LastLoginMethod),
    }
}

/// Génère un secret TOTP en attente de confirmation (remplace un enrôlement non confirmé).
#[utoipa::path(
    post,
    path = "/2fa/setup",
    tag = "auth",
    security(("bearer" = [])),
    responses(
        (status = 200, description = "Secret à enregistrer dans l'application d'authentification", body = TotpSetupResponse),
        (status = 401, description = "Jeton d'accès refusé", body = ErrorResponse),
        (status = 403, description = "Authentification trop ancienne", body = ErrorResponse),
        (status = 409, description = "Double authentification déjà active", body = ErrorResponse),
        (status = 503, description = "Double authentification non configurée", body = ErrorResponse),
    ),
)]
#[post("/2fa/setup")]
async fn setup_totp(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
) -> Result<HttpResponse, ApiError> {
    let key = totp_key(&state)?;
    require_recent(&claims)?;
    let user = state
        .store
        .find_user_by_id(claims.sub)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::Unauthorized)?;
    let secret = totp::new_secret();
    let staged = state
        .store
        .stage_totp(user.id, &key.encrypt(user.id, &secret))
        .await
        .map_err(ApiError::internal)?;
    if !staged {
        return Err(ApiError::TwoFactorAlreadyEnabled);
    }
    let account = user.email.as_deref().unwrap_or(&user.username);
    Ok(HttpResponse::Ok().json(TotpSetupResponse {
        secret: totp::encode_secret(&secret),
        otpauth_uri: totp::provisioning_uri(&secret, account),
    }))
}

/// Active la double authentification avec un premier code, et renvoie les codes de récupération.
#[utoipa::path(
    post,
    path = "/2fa/enable",
    tag = "auth",
    security(("bearer" = [])),
    request_body = SecondFactor,
    responses(
        (status = 200, description = "Double authentification active", body = RecoveryCodesResponse),
        (status = 401, description = "Jeton refusé, ou code refusé", body = ErrorResponse),
        (status = 403, description = "Authentification trop ancienne", body = ErrorResponse),
        (status = 409, description = "Aucun enrôlement en attente", body = ErrorResponse),
        (status = 429, description = "Trop de tentatives", body = ErrorResponse),
        (status = 503, description = "Double authentification non configurée", body = ErrorResponse),
    ),
)]
#[post("/2fa/enable")]
async fn enable_totp(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    request: web::Json<SecondFactor>,
) -> Result<HttpResponse, ApiError> {
    let key = totp_key(&state)?;
    require_recent(&claims)?;
    let record = state
        .store
        .find_totp(claims.sub)
        .await
        .map_err(ApiError::internal)?
        .filter(|record| !record.enabled)
        .ok_or(ApiError::TwoFactorNotPending)?;
    limit(&state, &format!("2fa:{}", claims.sub), CODE_ATTEMPTS).await?;
    let secret = key
        .decrypt(claims.sub, &record.ciphertext)
        .ok_or_else(|| ApiError::internal("secret TOTP indéchiffrable"))?;
    let step = request
        .code
        .as_deref()
        .and_then(|code| totp::verify(&secret, code, now_secs()))
        .ok_or(ApiError::InvalidSecondFactor)?;
    let codes = totp::new_recovery_codes();
    if !state
        .store
        .enable_totp(claims.sub, step, &hashes(&codes))
        .await
        .map_err(ApiError::internal)?
    {
        return Err(ApiError::InvalidSecondFactor);
    }
    Ok(HttpResponse::Ok().json(RecoveryCodesResponse {
        recovery_codes: codes,
    }))
}

/// Désactive la double authentification et révoque les jetons de rafraîchissement du compte.
#[utoipa::path(
    post,
    path = "/2fa/disable",
    tag = "auth",
    security(("bearer" = [])),
    request_body = SecondFactor,
    responses(
        (status = 204, description = "Double authentification désactivée"),
        (status = 401, description = "Jeton refusé, ou code refusé", body = ErrorResponse),
        (status = 403, description = "Authentification trop ancienne", body = ErrorResponse),
        (status = 409, description = "Double authentification inactive", body = ErrorResponse),
        (status = 429, description = "Trop de tentatives", body = ErrorResponse),
    ),
)]
#[post("/2fa/disable")]
async fn disable_totp(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    request: web::Json<SecondFactor>,
) -> Result<HttpResponse, ApiError> {
    require_recent(&claims)?;
    require_enabled(&state, claims.sub).await?;
    confirm_second_factor(&state, claims.sub, request.code.as_deref()).await?;
    if !state
        .store
        .disable_totp(claims.sub)
        .await
        .map_err(ApiError::internal)?
    {
        return Err(ApiError::TwoFactorNotEnabled);
    }
    Ok(HttpResponse::NoContent().finish())
}

/// Remplace les codes de récupération (les anciens deviennent inutilisables).
#[utoipa::path(
    post,
    path = "/2fa/recovery-codes",
    tag = "auth",
    security(("bearer" = [])),
    request_body = SecondFactor,
    responses(
        (status = 200, description = "Nouveaux codes", body = RecoveryCodesResponse),
        (status = 401, description = "Jeton refusé, ou code refusé", body = ErrorResponse),
        (status = 403, description = "Authentification trop ancienne", body = ErrorResponse),
        (status = 409, description = "Double authentification inactive", body = ErrorResponse),
        (status = 429, description = "Trop de tentatives", body = ErrorResponse),
    ),
)]
#[post("/2fa/recovery-codes")]
async fn regenerate_recovery_codes(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    request: web::Json<SecondFactor>,
) -> Result<HttpResponse, ApiError> {
    require_recent(&claims)?;
    require_enabled(&state, claims.sub).await?;
    confirm_second_factor(&state, claims.sub, request.code.as_deref()).await?;
    let codes = totp::new_recovery_codes();
    if !state
        .store
        .replace_recovery_codes(claims.sub, &hashes(&codes))
        .await
        .map_err(ApiError::internal)?
    {
        return Err(ApiError::TwoFactorNotEnabled);
    }
    Ok(HttpResponse::Ok().json(RecoveryCodesResponse {
        recovery_codes: codes,
    }))
}

async fn require_enabled(state: &AppState, user_id: Uuid) -> Result<(), ApiError> {
    let status = state
        .store
        .security_status(user_id)
        .await
        .map_err(ApiError::internal)?;
    if status.totp_enabled {
        Ok(())
    } else {
        Err(ApiError::TwoFactorNotEnabled)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usernames_derived_from_email_are_valid() {
        for email in [
            "alice@example.com",
            "a@example.com",
            "élodie.ünïcode+tag@example.com",
            "x".repeat(60).as_str(),
            "@example.com",
        ] {
            for attempt in 0..USERNAME_TRIES {
                let name = candidate_username(email, attempt);
                assert_eq!(username_error(&name), None, "{email} -> {name}");
            }
        }
        assert_eq!(candidate_username("alice@example.com", 0), "alice");
        assert_ne!(
            candidate_username("alice@example.com", 1),
            candidate_username("alice@example.com", 2)
        );
    }

    #[test]
    fn reauthentication_window() {
        let claims = |auth_time| Claims {
            sub: Uuid::new_v4(),
            username: "a".into(),
            role: crate::store::Role::User,
            iat: 0,
            exp: 0,
            auth_time,
        };
        assert!(require_recent(&claims(now_secs())).is_ok());
        assert!(require_recent(&claims(now_secs() - REAUTH_WINDOW_SECS - 5)).is_err());
        assert!(require_recent(&claims(0)).is_err());
    }
}
