//! Envoi des notifications push aux appareils (service Expo Push, utilisé par l'app mobile).

use async_trait::async_trait;
use serde_json::{Value, json};
use std::fmt;
use std::sync::Mutex;
use std::time::Duration;

const EXPO_ENDPOINT: &str = "https://exp.host/--/api/v2/push/send";
const SEND_TIMEOUT: Duration = Duration::from_secs(10);
/// Longueur maximale d'un jeton accepté à l'enregistrement.
pub const TOKEN_MAX: usize = 256;

/// Échec d'un envoi push.
#[derive(Debug, PartialEq, Eq)]
pub enum PushError {
    /// Le service ne connaît plus l'appareil : le jeton doit être supprimé.
    InvalidToken,
    /// Échec passager (réseau, limite de débit, panne du service) : l'envoi peut être repris.
    Transient(String),
    /// Refus définitif qui ne vient pas du jeton (message trop gros, configuration…).
    Rejected(String),
}

impl fmt::Display for PushError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PushError::InvalidToken => f.write_str("jeton push invalide"),
            PushError::Transient(detail) => write!(f, "échec passager du push : {detail}"),
            PushError::Rejected(detail) => write!(f, "push refusé : {detail}"),
        }
    }
}

impl std::error::Error for PushError {}

#[async_trait]
pub trait PushSender: Send + Sync {
    /// `false` quand aucun service n'est configuré : le canal push est alors ignoré.
    fn available(&self) -> bool {
        true
    }
    async fn send(
        &self,
        token: &str,
        title: &str,
        body: &str,
        data: &Value,
    ) -> Result<(), PushError>;
}

/// Un jeton Expo a la forme `ExponentPushToken[xxx]` (ou `ExpoPushToken[xxx]`).
pub fn is_valid_token(token: &str) -> bool {
    let inner = token
        .strip_prefix("ExponentPushToken[")
        .or_else(|| token.strip_prefix("ExpoPushToken["))
        .and_then(|rest| rest.strip_suffix(']'));
    token.len() <= TOKEN_MAX
        && inner.is_some_and(|inner| {
            !inner.is_empty()
                && inner
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        })
}

pub struct ExpoPush {
    client: reqwest::Client,
    endpoint: String,
    access_token: Option<String>,
}

impl ExpoPush {
    /// `access_token` : jeton d'accès Expo (`EXPO_ACCESS_TOKEN`), facultatif.
    pub fn new(access_token: Option<String>) -> Result<Self, PushError> {
        Self::with_endpoint(access_token, EXPO_ENDPOINT)
    }

    pub fn with_endpoint(access_token: Option<String>, endpoint: &str) -> Result<Self, PushError> {
        let client = reqwest::Client::builder()
            .timeout(SEND_TIMEOUT)
            .build()
            .map_err(|err| PushError::Rejected(err.to_string()))?;
        Ok(ExpoPush {
            client,
            endpoint: endpoint.to_string(),
            access_token,
        })
    }

    pub fn from_env() -> Option<Result<Self, PushError>> {
        let enabled = std::env::var("PUSH_ENABLED").is_ok_and(|v| v == "1" || v == "true");
        enabled.then(|| {
            Self::new(
                std::env::var("EXPO_ACCESS_TOKEN")
                    .ok()
                    .filter(|t| !t.is_empty()),
            )
        })
    }
}

/// Interprète la réponse HTTP du service : statut et corps JSON.
pub fn interpret_response(status: u16, body: &Value) -> Result<(), PushError> {
    if status == 429 || status >= 500 {
        return Err(PushError::Transient(format!(
            "le service a répondu {status}"
        )));
    }
    if !(200..300).contains(&status) {
        return Err(PushError::Rejected(format!(
            "le service a répondu {status}"
        )));
    }
    // Un envoi unitaire renvoie `{"data": {...}}`, un lot `{"data": [{...}]}`.
    let ticket = match &body["data"] {
        Value::Array(tickets) => tickets.first().unwrap_or(&Value::Null),
        other => other,
    };
    if ticket["status"] == "ok" {
        return Ok(());
    }
    match ticket["details"]["error"].as_str() {
        Some("DeviceNotRegistered") => Err(PushError::InvalidToken),
        Some("MessageRateExceeded") => Err(PushError::Transient("débit dépassé".into())),
        Some(other) => Err(PushError::Rejected(other.to_string())),
        None => Err(PushError::Rejected(
            ticket["message"]
                .as_str()
                .unwrap_or("réponse inattendue")
                .to_string(),
        )),
    }
}

#[async_trait]
impl PushSender for ExpoPush {
    async fn send(
        &self,
        token: &str,
        title: &str,
        body: &str,
        data: &Value,
    ) -> Result<(), PushError> {
        let mut request = self.client.post(&self.endpoint).json(&json!({
            "to": token,
            "title": title,
            "body": body,
            "data": data,
            "sound": "default",
        }));
        if let Some(access_token) = &self.access_token {
            request = request.bearer_auth(access_token);
        }
        let response = request
            .send()
            .await
            .map_err(|err| PushError::Transient(err.without_url().to_string()))?;
        let status = response.status().as_u16();
        let body: Value = response.json().await.unwrap_or(Value::Null);
        interpret_response(status, &body)
    }
}

/// Aucun service push configuré : le canal est ignoré.
pub struct NoopPush;

#[async_trait]
impl PushSender for NoopPush {
    fn available(&self) -> bool {
        false
    }
    async fn send(&self, _: &str, _: &str, _: &str, _: &Value) -> Result<(), PushError> {
        Err(PushError::Rejected("push non configuré".into()))
    }
}

/// Un push envoyé, pour les tests.
#[derive(Debug, Clone, PartialEq)]
pub struct SentPush {
    pub token: String,
    pub title: String,
    pub body: String,
    pub data: Value,
}

/// Garde les envois en mémoire ; peut simuler des jetons invalides et des échecs passagers.
#[derive(Default)]
pub struct MemoryPush {
    sent: Mutex<Vec<SentPush>>,
    pub invalid_tokens: Mutex<Vec<String>>,
    /// Nombre d'envois à refuser (échec passager) avant d'en accepter.
    pub transient_failures: Mutex<usize>,
}

impl MemoryPush {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn sent(&self) -> Vec<SentPush> {
        self.sent.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

#[async_trait]
impl PushSender for MemoryPush {
    async fn send(
        &self,
        token: &str,
        title: &str,
        body: &str,
        data: &Value,
    ) -> Result<(), PushError> {
        if self
            .invalid_tokens
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .any(|t| t == token)
        {
            return Err(PushError::InvalidToken);
        }
        {
            let mut failures = self
                .transient_failures
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if *failures > 0 {
                *failures -= 1;
                return Err(PushError::Transient("échec simulé".into()));
            }
        }
        self.sent
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(SentPush {
                token: token.to_string(),
                title: title.to_string(),
                body: body.to_string(),
                data: data.clone(),
            });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_format() {
        assert!(is_valid_token("ExponentPushToken[abc-DEF_123]"));
        assert!(is_valid_token("ExpoPushToken[abc]"));
        for bad in [
            "",
            "abc",
            "ExponentPushToken[]",
            "ExponentPushToken[a b]",
            "ExponentPushToken[abc",
            "ExponentPushToken[<script>]",
        ] {
            assert!(!is_valid_token(bad), "{bad}");
        }
        let long = format!("ExponentPushToken[{}]", "a".repeat(TOKEN_MAX));
        assert!(!is_valid_token(&long));
    }

    #[test]
    fn responses_are_classified() {
        assert_eq!(
            interpret_response(200, &json!({"data": {"status": "ok"}})),
            Ok(())
        );
        assert_eq!(
            interpret_response(
                200,
                &json!({"data": {"status": "error", "details": {"error": "DeviceNotRegistered"}}})
            ),
            Err(PushError::InvalidToken)
        );
        assert!(matches!(
            interpret_response(429, &Value::Null),
            Err(PushError::Transient(_))
        ));
        assert!(matches!(
            interpret_response(503, &Value::Null),
            Err(PushError::Transient(_))
        ));
        assert!(matches!(
            interpret_response(400, &Value::Null),
            Err(PushError::Rejected(_))
        ));
        assert!(matches!(
            interpret_response(
                200,
                &json!({"data": {"status": "error", "details": {"error": "MessageTooBig"}}})
            ),
            Err(PushError::Rejected(_))
        ));
    }
}
