//! Configuration de l'authentification, lue dans l'environnement (voir `.env.example`).

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
}
