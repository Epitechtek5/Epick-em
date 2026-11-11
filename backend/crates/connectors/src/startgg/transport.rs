//! Transport GraphQL vers start.gg, remplaçable par un double dans les tests.

use crate::connector::ConnectorError;
use async_trait::async_trait;
use serde_json::{Value, json};
use std::fmt;
use std::time::Duration;

/// Point d'entrée fixe de l'API publique de start.gg.
pub const ENDPOINT: &str = "https://api.start.gg/gql/alpha";
const TIMEOUT: Duration = Duration::from_secs(20);

/// Exécute une requête GraphQL et renvoie le champ `data`.
#[async_trait]
pub trait GraphqlTransport: Send + Sync {
    async fn query(&self, query: &str, variables: Value) -> Result<Value, ConnectorError>;
}

/// Accès HTTP réel, authentifié par le jeton d'API (`STARTGG_TOKEN`).
pub struct HttpTransport {
    client: reqwest::Client,
    token: String,
}

// Écrit à la main : le jeton n'apparaît jamais dans les journaux.
impl fmt::Debug for HttpTransport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HttpTransport")
            .field("token", &"<masqué>")
            .finish()
    }
}

impl HttpTransport {
    pub fn new(token: impl Into<String>) -> Result<Self, reqwest::Error> {
        Ok(HttpTransport {
            client: reqwest::Client::builder()
                .timeout(TIMEOUT)
                // Pas de redirection : la requête ne quitte jamais api.start.gg.
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            token: token.into(),
        })
    }
}

/// Traduit les erreurs GraphQL de start.gg (renvoyées avec un statut 200).
pub fn graphql_error(errors: &Value) -> ConnectorError {
    let message = errors
        .as_array()
        .and_then(|errors| errors.first())
        .and_then(|error| error["message"].as_str())
        .unwrap_or("erreur GraphQL")
        .to_string();
    let lower = message.to_lowercase();
    if lower.contains("rate limit") {
        ConnectorError::RateLimited { retry_after: None }
    } else if lower.contains("complexity") {
        ConnectorError::TooComplex
    } else if lower.contains("not found") {
        ConnectorError::NotFound
    } else if lower.contains("auth") {
        ConnectorError::Unauthorized
    } else {
        ConnectorError::Unavailable(message)
    }
}

/// Réponse HTTP brute → `data`.
pub fn interpret(
    status: u16,
    retry_after: Option<&str>,
    body: &[u8],
) -> Result<Value, ConnectorError> {
    match status {
        429 => {
            return Err(ConnectorError::RateLimited {
                retry_after: retry_after
                    .and_then(|v| v.trim().parse::<u64>().ok())
                    .map(Duration::from_secs),
            });
        }
        401 | 403 => return Err(ConnectorError::Unauthorized),
        500..=599 => return Err(ConnectorError::Unavailable(format!("HTTP {status}"))),
        200..=299 => {}
        other => return Err(ConnectorError::Unavailable(format!("HTTP {other}"))),
    }
    let body: Value = serde_json::from_slice(body)
        .map_err(|_| ConnectorError::Unavailable("réponse illisible".into()))?;
    if let Some(errors) = body.get("errors").filter(|e| !e.is_null()) {
        return Err(graphql_error(errors));
    }
    match body.get("data") {
        Some(data) if !data.is_null() => Ok(data.clone()),
        _ => Err(ConnectorError::Unavailable("réponse sans données".into())),
    }
}

#[async_trait]
impl GraphqlTransport for HttpTransport {
    async fn query(&self, query: &str, variables: Value) -> Result<Value, ConnectorError> {
        let response = self
            .client
            .post(ENDPOINT)
            .bearer_auth(&self.token)
            .json(&json!({ "query": query, "variables": variables }))
            .send()
            .await
            .map_err(|err| {
                if err.is_timeout() {
                    ConnectorError::Timeout
                } else {
                    ConnectorError::Unavailable(err.without_url().to_string())
                }
            })?;
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let body = response.bytes().await.map_err(|err| {
            if err.is_timeout() {
                ConnectorError::Timeout
            } else {
                ConnectorError::Unavailable(err.without_url().to_string())
            }
        })?;
        interpret(status, retry_after.as_deref(), &body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_statuses_are_classified() {
        assert_eq!(
            interpret(429, Some("12"), b"").unwrap_err(),
            ConnectorError::RateLimited {
                retry_after: Some(Duration::from_secs(12))
            }
        );
        assert_eq!(
            interpret(429, None, b"").unwrap_err(),
            ConnectorError::RateLimited { retry_after: None }
        );
        assert_eq!(
            interpret(401, None, b"").unwrap_err(),
            ConnectorError::Unauthorized
        );
        assert!(interpret(503, None, b"").unwrap_err().is_transient());
        assert!(interpret(200, None, b"<html>").unwrap_err().is_transient());
        assert_eq!(
            interpret(200, None, br#"{"data":{"x":1}}"#).unwrap(),
            json!({"x": 1})
        );
    }

    #[test]
    fn graphql_errors_are_classified() {
        let error = |m: &str| {
            interpret(
                200,
                None,
                json!({"errors":[{"message": m}]}).to_string().as_bytes(),
            )
        };
        assert_eq!(
            error("Rate limit exceeded - api-token").unwrap_err(),
            ConnectorError::RateLimited { retry_after: None }
        );
        assert_eq!(
            error("Your query complexity is too high. A maximum of 1000 objects may be returned")
                .unwrap_err(),
            ConnectorError::TooComplex
        );
        assert_eq!(
            error("Invalid authentication token").unwrap_err(),
            ConnectorError::Unauthorized
        );
    }

    #[test]
    fn the_token_is_never_printed() {
        let transport = HttpTransport::new("secret-token-123").unwrap();
        assert!(!format!("{transport:?}").contains("secret-token-123"));
    }
}
