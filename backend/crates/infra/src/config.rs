//! Configuration des connexions, lue dans les variables d'environnement (voir `.env.example`).

use std::fmt;

const DEFAULT_DATABASE_MAX_CONNECTIONS: u32 = 10;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub database_max_connections: u32,
    pub redis_url: String,
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

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Variante testable de [`Config::from_env`] : `lookup` renvoie la valeur d'une variable.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let required = |name: &'static str| {
            lookup(name)
                .filter(|value| !value.is_empty())
                .ok_or(ConfigError::Missing(name))
        };
        let database_max_connections = match lookup("DATABASE_MAX_CONNECTIONS") {
            None => DEFAULT_DATABASE_MAX_CONNECTIONS,
            Some(value) => value
                .parse()
                .ok()
                .filter(|&n| n > 0)
                .ok_or(ConfigError::Invalid("DATABASE_MAX_CONNECTIONS"))?,
        };
        Ok(Config {
            database_url: required("DATABASE_URL")?,
            database_max_connections,
            redis_url: required("REDIS_URL")?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config(vars: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        Config::from_lookup(|name| vars.get(name).cloned())
    }

    #[test]
    fn reads_required_variables_with_defaults() {
        let config = config(&[
            ("DATABASE_URL", "postgres://db"),
            ("REDIS_URL", "redis://r"),
        ])
        .unwrap();
        assert_eq!(config.database_url, "postgres://db");
        assert_eq!(config.redis_url, "redis://r");
        assert_eq!(
            config.database_max_connections,
            DEFAULT_DATABASE_MAX_CONNECTIONS
        );
    }

    #[test]
    fn missing_or_empty_variable_is_an_error() {
        assert_eq!(
            config(&[("REDIS_URL", "redis://r")]).unwrap_err(),
            ConfigError::Missing("DATABASE_URL")
        );
        assert_eq!(
            config(&[("DATABASE_URL", "postgres://db"), ("REDIS_URL", "")]).unwrap_err(),
            ConfigError::Missing("REDIS_URL")
        );
    }

    #[test]
    fn max_connections_must_be_positive() {
        let base = [
            ("DATABASE_URL", "postgres://db"),
            ("REDIS_URL", "redis://r"),
        ];
        for bad in ["0", "-1", "abc"] {
            let mut vars = base.to_vec();
            vars.push(("DATABASE_MAX_CONNECTIONS", bad));
            assert_eq!(
                config(&vars).unwrap_err(),
                ConfigError::Invalid("DATABASE_MAX_CONNECTIONS")
            );
        }
        let mut vars = base.to_vec();
        vars.push(("DATABASE_MAX_CONNECTIONS", "25"));
        assert_eq!(config(&vars).unwrap().database_max_connections, 25);
    }
}
