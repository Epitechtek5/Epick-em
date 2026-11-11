//! Configuration de l'authentification, lue dans l'environnement (voir `.env.example`).

use crate::totp::TotpKey;
use std::fmt;
use std::time::Duration;

const DEFAULT_ACCESS_TOKEN_TTL_SECS: u64 = 15 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECS: u64 = 30 * 24 * 60 * 60;
const MIN_JWT_SECRET_LEN: usize = 32;

#[derive(Clone)]
pub struct AuthConfig {
    pub jwt_secret: String,
    pub access_token_ttl: Duration,
    pub refresh_token_ttl: Duration,
}

// Écrit à la main pour ne jamais journaliser la clé de signature.
impl fmt::Debug for AuthConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AuthConfig")
            .field("jwt_secret", &"<masqué>")
            .field("access_token_ttl", &self.access_token_ttl)
            .field("refresh_token_ttl", &self.refresh_token_ttl)
            .finish()
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum ConfigError {
    Missing(&'static str),
    Invalid(&'static str),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::Missing(name) => write!(f, "la variable {name} est requise"),
            ConfigError::Invalid(name) => write!(f, "la variable {name} est invalide"),
        }
    }
}

impl std::error::Error for ConfigError {}

impl AuthConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Variante testable de [`AuthConfig::from_env`] : `lookup` renvoie la valeur d'une variable.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let jwt_secret = lookup("JWT_SECRET")
            .filter(|value| !value.is_empty())
            .ok_or(ConfigError::Missing("JWT_SECRET"))?;
        if jwt_secret.len() < MIN_JWT_SECRET_LEN {
            return Err(ConfigError::Invalid("JWT_SECRET"));
        }
        let seconds = |name: &'static str, default: u64| match lookup(name) {
            None => Ok(Duration::from_secs(default)),
            Some(value) => value
                .parse()
                .ok()
                .filter(|&n| n > 0)
                .map(Duration::from_secs)
                .ok_or(ConfigError::Invalid(name)),
        };
        Ok(AuthConfig {
            jwt_secret,
            access_token_ttl: seconds("ACCESS_TOKEN_TTL_SECS", DEFAULT_ACCESS_TOKEN_TTL_SECS)?,
            refresh_token_ttl: seconds("REFRESH_TOKEN_TTL_SECS", DEFAULT_REFRESH_TOKEN_TTL_SECS)?,
        })
    }
}

/// Connexion Google (OpenID Connect, code d'autorisation + PKCE).
#[derive(Clone)]
pub struct GoogleConfig {
    pub client_id: String,
    pub client_secret: String,
    /// URL de retour enregistrée chez Google : page du front qui renvoie `code` et `state` à
    /// `POST /auth/google/callback` (ou `/account/google/link`).
    pub redirect_uri: String,
}

impl fmt::Debug for GoogleConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GoogleConfig")
            .field("client_id", &self.client_id)
            .field("client_secret", &"<masqué>")
            .field("redirect_uri", &self.redirect_uri)
            .finish()
    }
}

/// Connexion Google et double authentification. Chaque partie est facultative : sans elle, ses
/// routes répondent `503 not_configured`.
#[derive(Clone, Debug, Default)]
pub struct SecurityConfig {
    pub google: Option<GoogleConfig>,
    /// Clé de chiffrement des secrets TOTP (`TOTP_ENCRYPTION_KEY`, 64 caractères hexadécimaux).
    pub totp_key: Option<TotpKey>,
}

impl SecurityConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Variante testable de [`SecurityConfig::from_env`].
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let get = |name: &str| lookup(name).filter(|value| !value.trim().is_empty());
        let google = match (
            get("GOOGLE_CLIENT_ID"),
            get("GOOGLE_CLIENT_SECRET"),
            get("GOOGLE_REDIRECT_URI"),
        ) {
            (None, None, None) => None,
            (Some(client_id), Some(client_secret), Some(redirect_uri)) => {
                if !valid_redirect_uri(&redirect_uri) {
                    return Err(ConfigError::Invalid("GOOGLE_REDIRECT_URI"));
                }
                Some(GoogleConfig {
                    client_id,
                    client_secret,
                    redirect_uri,
                })
            }
            (None, ..) => return Err(ConfigError::Missing("GOOGLE_CLIENT_ID")),
            (_, None, _) => return Err(ConfigError::Missing("GOOGLE_CLIENT_SECRET")),
            (.., None) => return Err(ConfigError::Missing("GOOGLE_REDIRECT_URI")),
        };
        let totp_key = match get("TOTP_ENCRYPTION_KEY") {
            None => None,
            Some(value) => {
                Some(TotpKey::from_hex(&value).ok_or(ConfigError::Invalid("TOTP_ENCRYPTION_KEY"))?)
            }
        };
        Ok(SecurityConfig { google, totp_key })
    }
}

/// HTTPS, ou HTTP vers la machine locale (développement).
fn valid_redirect_uri(value: &str) -> bool {
    url::Url::parse(value).is_ok_and(|url| match url.scheme() {
        "https" => url.host().is_some(),
        "http" => matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")),
        _ => false,
    } && url.fragment().is_none())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const SECRET: &str = "0123456789abcdef0123456789abcdef";

    fn config(vars: &[(&str, &str)]) -> Result<AuthConfig, ConfigError> {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        AuthConfig::from_lookup(|name| vars.get(name).cloned())
    }

    #[test]
    fn reads_secret_with_default_durations() {
        let config = config(&[("JWT_SECRET", SECRET)]).unwrap();
        assert_eq!(config.jwt_secret, SECRET);
        assert_eq!(
            config.access_token_ttl,
            Duration::from_secs(DEFAULT_ACCESS_TOKEN_TTL_SECS)
        );
        assert_eq!(
            config.refresh_token_ttl,
            Duration::from_secs(DEFAULT_REFRESH_TOKEN_TTL_SECS)
        );
    }

    #[test]
    fn secret_is_required_and_long_enough() {
        assert_eq!(config(&[]).unwrap_err(), ConfigError::Missing("JWT_SECRET"));
        assert_eq!(
            config(&[("JWT_SECRET", "")]).unwrap_err(),
            ConfigError::Missing("JWT_SECRET")
        );
        assert_eq!(
            config(&[("JWT_SECRET", "trop-court")]).unwrap_err(),
            ConfigError::Invalid("JWT_SECRET")
        );
    }

    #[test]
    fn durations_must_be_positive_integers() {
        for bad in ["0", "-1", "abc"] {
            assert_eq!(
                config(&[("JWT_SECRET", SECRET), ("ACCESS_TOKEN_TTL_SECS", bad)]).unwrap_err(),
                ConfigError::Invalid("ACCESS_TOKEN_TTL_SECS")
            );
            assert_eq!(
                config(&[("JWT_SECRET", SECRET), ("REFRESH_TOKEN_TTL_SECS", bad)]).unwrap_err(),
                ConfigError::Invalid("REFRESH_TOKEN_TTL_SECS")
            );
        }
        let config = config(&[("JWT_SECRET", SECRET), ("ACCESS_TOKEN_TTL_SECS", "60")]).unwrap();
        assert_eq!(config.access_token_ttl, Duration::from_secs(60));
    }

    #[test]
    fn debug_hides_the_secret() {
        let config = config(&[("JWT_SECRET", SECRET)]).unwrap();
        assert!(!format!("{config:?}").contains(SECRET));
    }

    fn security(vars: &[(&str, &str)]) -> Result<SecurityConfig, ConfigError> {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        SecurityConfig::from_lookup(|name| vars.get(name).cloned())
    }

    #[test]
    fn security_is_optional_but_complete() {
        let none = security(&[]).unwrap();
        assert!(none.google.is_none() && none.totp_key.is_none());
        let google = [
            ("GOOGLE_CLIENT_ID", "id.apps.googleusercontent.com"),
            ("GOOGLE_CLIENT_SECRET", "chut"),
            (
                "GOOGLE_REDIRECT_URI",
                "https://epickem.app/auth/google/callback",
            ),
            ("TOTP_ENCRYPTION_KEY", &"0f".repeat(32)),
        ];
        let full = security(&google).unwrap();
        assert_eq!(full.google.as_ref().unwrap().client_id, google[0].1);
        assert!(full.totp_key.is_some());
        assert!(!format!("{full:?}").contains("chut"));
        assert_eq!(
            security(&google[..1]).unwrap_err(),
            ConfigError::Missing("GOOGLE_CLIENT_SECRET")
        );
        assert_eq!(
            security(&google[1..3]).unwrap_err(),
            ConfigError::Missing("GOOGLE_CLIENT_ID")
        );
        assert_eq!(
            security(&[("TOTP_ENCRYPTION_KEY", "court")]).unwrap_err(),
            ConfigError::Invalid("TOTP_ENCRYPTION_KEY")
        );
    }

    #[test]
    fn redirect_uri_must_be_https_or_local() {
        assert!(valid_redirect_uri("https://epickem.app/auth/google"));
        assert!(valid_redirect_uri("http://localhost:5173/auth/google"));
        assert!(!valid_redirect_uri("http://epickem.app/auth/google"));
        assert!(!valid_redirect_uri("javascript:alert(1)"));
        assert!(!valid_redirect_uri("https://epickem.app/#frag"));
        assert!(!valid_redirect_uri("pas une url"));
    }
}
