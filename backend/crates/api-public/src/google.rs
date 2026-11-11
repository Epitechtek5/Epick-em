//! Connexion Google : OpenID Connect avec code d'autorisation et PKCE (S256).
//!
//! Le serveur génère `state`, `nonce` et le vérificateur PKCE et les garde (empreinte du `state`
//! en base, voir [`crate::store::OAuthState`]) ; le navigateur ne transporte que `state` et le
//! code. Le jeton d'identité est validé ici : signature RS256 avec les clés publiées par Google
//! (JWKS), émetteur, audience (notre `client_id`), expiration et `nonce`. Le compte est identifié
//! par le claim `sub`, stable, jamais par l'adresse e-mail.
//!
//! Les appels sortants ne visent que les deux URL fixes de Google ci-dessous : aucune URL fournie
//! par un client n'est jamais appelée.

use crate::config::GoogleConfig;
use async_trait::async_trait;
use data_encoding::BASE64URL_NOPAD;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const AUTHORIZATION_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const JWKS_URI: &str = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS: [&str; 2] = ["https://accounts.google.com", "accounts.google.com"];
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);
/// Les clés de Google changent rarement ; un `kid` inconnu force un rechargement.
const JWKS_TTL: Duration = Duration::from_secs(60 * 60);

#[derive(Debug)]
pub enum OidcError {
    /// Google est injoignable ou a refusé l'échange (code expiré, déjà utilisé…).
    Provider(String),
    /// Jeton d'identité invalide (signature, émetteur, audience, expiration ou nonce).
    InvalidToken(String),
}

impl fmt::Display for OidcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OidcError::Provider(detail) => write!(f, "fournisseur OIDC : {detail}"),
            OidcError::InvalidToken(detail) => write!(f, "jeton d'identité invalide : {detail}"),
        }
    }
}

impl std::error::Error for OidcError {}

/// Accès réseau au fournisseur, remplaçable dans les tests.
#[async_trait]
pub trait OidcProvider: Send + Sync {
    /// Échange le code d'autorisation contre le jeton d'identité (JWT brut).
    async fn exchange_code(&self, code: &str, code_verifier: &str) -> Result<String, OidcError>;

    /// Clés publiques de signature ; `refresh` ignore le cache.
    async fn signing_keys(&self, refresh: bool) -> Result<JwkSet, OidcError>;
}

/// Identité vérifiée.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub subject: String,
    pub email: Option<String>,
    pub email_verified: bool,
    pub name: Option<String>,
}

#[derive(Deserialize)]
struct IdTokenClaims {
    sub: String,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    email_verified: Option<serde_json::Value>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    nonce: Option<String>,
}

/// Connexion Google configurée : identifiants de l'application et accès réseau.
pub struct GoogleAuth {
    pub config: GoogleConfig,
    provider: Arc<dyn OidcProvider>,
}

impl GoogleAuth {
    pub fn new(config: GoogleConfig, provider: Arc<dyn OidcProvider>) -> Self {
        GoogleAuth { config, provider }
    }

    /// Avec l'accès réseau réel à Google.
    pub fn connect(config: GoogleConfig) -> Result<Self, reqwest::Error> {
        let provider = Arc::new(GoogleHttp::new(&config)?);
        Ok(Self::new(config, provider))
    }

    /// URL vers laquelle rediriger le navigateur.
    pub fn authorization_url(&self, state: &str, nonce: &str, code_verifier: &str) -> String {
        let mut url = url::Url::parse(AUTHORIZATION_ENDPOINT).expect("URL constante valide");
        url.query_pairs_mut()
            .append_pair("client_id", &self.config.client_id)
            .append_pair("redirect_uri", &self.config.redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", "openid email profile")
            .append_pair("state", state)
            .append_pair("nonce", nonce)
            .append_pair("code_challenge", &pkce_challenge(code_verifier))
            .append_pair("code_challenge_method", "S256")
            .append_pair("prompt", "select_account");
        url.into()
    }

    /// Échange le code et valide le jeton d'identité obtenu.
    pub async fn authenticate(
        &self,
        code: &str,
        code_verifier: &str,
        nonce: &str,
    ) -> Result<Identity, OidcError> {
        let id_token = self.provider.exchange_code(code, code_verifier).await?;
        let kid = jsonwebtoken::decode_header(&id_token)
            .map_err(|err| OidcError::InvalidToken(err.to_string()))?
            .kid
            .ok_or_else(|| OidcError::InvalidToken("kid absent".into()))?;
        let mut keys = self.provider.signing_keys(false).await?;
        if keys.find(&kid).is_none() {
            keys = self.provider.signing_keys(true).await?;
        }
        verify_id_token(&id_token, &keys, &self.config.client_id, nonce)
    }
}

/// `code_challenge` PKCE S256 : base64url(SHA-256(vérificateur)).
pub fn pkce_challenge(code_verifier: &str) -> String {
    BASE64URL_NOPAD.encode(&Sha256::digest(code_verifier.as_bytes()))
}

/// Valide le jeton d'identité : RS256 avec une clé de `keys`, émetteur Google, audience
/// `client_id`, non expiré, `nonce` attendu.
pub fn verify_id_token(
    token: &str,
    keys: &JwkSet,
    client_id: &str,
    nonce: &str,
) -> Result<Identity, OidcError> {
    let invalid = |detail: &str| OidcError::InvalidToken(detail.to_string());
    let header = jsonwebtoken::decode_header(token).map_err(|e| invalid(&e.to_string()))?;
    if header.alg != Algorithm::RS256 {
        return Err(invalid("algorithme inattendu"));
    }
    let kid = header.kid.ok_or_else(|| invalid("kid absent"))?;
    let jwk = keys.find(&kid).ok_or_else(|| invalid("clé inconnue"))?;
    let key = DecodingKey::from_jwk(jwk).map_err(|e| invalid(&e.to_string()))?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[client_id]);
    validation.set_issuer(&ISSUERS);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    let claims = jsonwebtoken::decode::<IdTokenClaims>(token, &key, &validation)
        .map_err(|e| invalid(&e.to_string()))?
        .claims;
    // Comparaison sur les empreintes : durée indépendante du contenu.
    let expected = Sha256::digest(nonce.as_bytes());
    let received = Sha256::digest(claims.nonce.unwrap_or_default().as_bytes());
    if nonce.is_empty() || expected != received {
        return Err(invalid("nonce inattendu"));
    }
    if claims.sub.is_empty() || claims.sub.len() > 255 {
        return Err(invalid("sub invalide"));
    }
    // Google renvoie un booléen, parfois la chaîne "true".
    let email_verified = match claims.email_verified {
        Some(serde_json::Value::Bool(value)) => value,
        Some(serde_json::Value::String(value)) => value == "true",
        _ => false,
    };
    Ok(Identity {
        subject: claims.sub,
        email: claims.email,
        email_verified,
        name: claims.name,
    })
}

/// Accès HTTP réel à Google.
struct GoogleHttp {
    client: reqwest::Client,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    keys: Mutex<Option<(JwkSet, Instant)>>,
}

impl GoogleHttp {
    fn new(config: &GoogleConfig) -> Result<Self, reqwest::Error> {
        Ok(GoogleHttp {
            client: reqwest::Client::builder()
                .timeout(HTTP_TIMEOUT)
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            client_id: config.client_id.clone(),
            client_secret: config.client_secret.clone(),
            redirect_uri: config.redirect_uri.clone(),
            keys: Mutex::new(None),
        })
    }
}

#[derive(Deserialize)]
struct TokenEndpointResponse {
    id_token: Option<String>,
}

#[async_trait]
impl OidcProvider for GoogleHttp {
    async fn exchange_code(&self, code: &str, code_verifier: &str) -> Result<String, OidcError> {
        let response = self
            .client
            .post(TOKEN_ENDPOINT)
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("code_verifier", code_verifier),
                ("client_id", &self.client_id),
                ("client_secret", &self.client_secret),
                ("redirect_uri", &self.redirect_uri),
            ])
            .send()
            .await
            .map_err(|err| OidcError::Provider(err.without_url().to_string()))?;
        let status = response.status();
        if !status.is_success() {
            // Le corps (qui peut citer le code) n'est pas journalisé.
            return Err(OidcError::Provider(format!("échange refusé ({status})")));
        }
        response
            .json::<TokenEndpointResponse>()
            .await
            .map_err(|err| OidcError::Provider(err.without_url().to_string()))?
            .id_token
            .ok_or_else(|| OidcError::Provider("id_token absent".into()))
    }

    async fn signing_keys(&self, refresh: bool) -> Result<JwkSet, OidcError> {
        if !refresh
            && let Some((keys, fetched)) = &*self.keys.lock().unwrap_or_else(|e| e.into_inner())
            && fetched.elapsed() < JWKS_TTL
        {
            return Ok(keys.clone());
        }
        let keys = self
            .client
            .get(JWKS_URI)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|err| OidcError::Provider(err.without_url().to_string()))?
            .json::<JwkSet>()
            .await
            .map_err(|err| OidcError::Provider(err.without_url().to_string()))?;
        *self.keys.lock().unwrap_or_else(|e| e.into_inner()) = Some((keys.clone(), Instant::now()));
        Ok(keys)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Exemple de l'annexe B de la RFC 7636.
    #[test]
    fn pkce_s256_matches_rfc7636() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn authorization_url_carries_pkce_state_and_nonce() {
        struct Never;
        #[async_trait]
        impl OidcProvider for Never {
            async fn exchange_code(&self, _: &str, _: &str) -> Result<String, OidcError> {
                unreachable!()
            }
            async fn signing_keys(&self, _: bool) -> Result<JwkSet, OidcError> {
                unreachable!()
            }
        }
        let google = GoogleAuth::new(
            GoogleConfig {
                client_id: "client".into(),
                client_secret: "secret".into(),
                redirect_uri: "https://epickem.test/auth/google".into(),
            },
            Arc::new(Never),
        );
        let url = url::Url::parse(&google.authorization_url("st", "no", "verifier")).unwrap();
        let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(url.host_str(), Some("accounts.google.com"));
        assert_eq!(query["client_id"], "client");
        assert_eq!(query["redirect_uri"], "https://epickem.test/auth/google");
        assert_eq!(query["state"], "st");
        assert_eq!(query["nonce"], "no");
        assert_eq!(query["code_challenge"], pkce_challenge("verifier"));
        assert_eq!(query["code_challenge_method"], "S256");
        assert_eq!(query["response_type"], "code");
        assert!(query["scope"].contains("openid"));
        assert!(!url.as_str().contains("secret"));
    }
}
