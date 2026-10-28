//! Envoi des e-mails transactionnels (aujourd'hui : la réinitialisation du mot de passe).
//!
//! [`ResendMailer`] passe par l'API HTTP de Resend en production ; [`MemoryMailer`] garde les
//! messages en mémoire pour les tests, et [`NoopMailer`] sert quand Resend n'est pas configuré.

use async_trait::async_trait;
use serde_json::json;
use std::fmt;
use std::sync::Mutex;
use std::time::Duration;

const RESEND_ENDPOINT: &str = "https://api.resend.com/emails";
const SEND_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug)]
pub struct MailError(String);

impl fmt::Display for MailError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for MailError {}

#[async_trait]
pub trait Mailer: Send + Sync {
    /// Envoie à `to` le message qui contient `link`, le lien de réinitialisation du mot de passe.
    async fn send_password_reset(&self, to: &str, link: &str) -> Result<(), MailError>;
}

/// Configuration de l'envoi, lue dans l'environnement (voir `.env.example`).
#[derive(Clone)]
pub struct MailConfig {
    pub api_key: String,
    /// Expéditeur, sur un domaine vérifié chez Resend (ex. `Epick'em <no-reply@epickem.app>`).
    pub from: String,
    /// Début du lien envoyé : le jeton y est ajouté en paramètre `token`.
    pub reset_url: String,
}

// Écrit à la main pour ne jamais journaliser la clé d'API.
impl fmt::Debug for MailConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MailConfig")
            .field("api_key", &"<masqué>")
            .field("from", &self.from)
            .field("reset_url", &self.reset_url)
            .finish()
    }
}

impl MailConfig {
    /// `None` si `RESEND_API_KEY` n'est pas définie : l'envoi est alors désactivé.
    pub fn from_env() -> Option<Self> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Variante testable de [`MailConfig::from_env`] : `lookup` renvoie la valeur d'une variable.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Option<Self> {
        let get = |name: &str| lookup(name).filter(|value| !value.is_empty());
        Some(MailConfig {
            api_key: get("RESEND_API_KEY")?,
            from: get("MAIL_FROM").unwrap_or_else(|| "Epick'em <onboarding@resend.dev>".into()),
            reset_url: get("PASSWORD_RESET_URL")
                .unwrap_or_else(|| "http://localhost:3000/reset-password".into()),
        })
    }
}

/// Lien envoyé par e-mail : `reset_url` suivi du jeton (hexadécimal, donc sans échappement).
pub fn reset_link(reset_url: &str, token: &str) -> String {
    let separator = if reset_url.contains('?') { '&' } else { '?' };
    format!("{reset_url}{separator}token={token}")
}

pub struct ResendMailer {
    client: reqwest::Client,
    api_key: String,
    from: String,
    endpoint: String,
}

impl ResendMailer {
    pub fn new(config: &MailConfig) -> Result<Self, MailError> {
        Self::with_endpoint(config, RESEND_ENDPOINT)
    }

    /// Variante qui vise un autre serveur que Resend (tests).
    pub fn with_endpoint(config: &MailConfig, endpoint: &str) -> Result<Self, MailError> {
        let client = reqwest::Client::builder()
            .timeout(SEND_TIMEOUT)
            .build()
            .map_err(|err| MailError(err.to_string()))?;
        Ok(ResendMailer {
            client,
            api_key: config.api_key.clone(),
            from: config.from.clone(),
            endpoint: endpoint.to_string(),
        })
    }
}

#[async_trait]
impl Mailer for ResendMailer {
    async fn send_password_reset(&self, to: &str, link: &str) -> Result<(), MailError> {
        let response = self
            .client
            .post(&self.endpoint)
            .bearer_auth(&self.api_key)
            .json(&json!({
                "from": self.from,
                "to": [to],
                "subject": "Réinitialisation de votre mot de passe Epick'em",
                "html": reset_html(link),
                "text": reset_text(link),
            }))
            .send()
            .await
            .map_err(|err| MailError(err.without_url().to_string()))?;
        let status = response.status();
        if status.is_success() {
            Ok(())
        } else {
            Err(MailError(format!("Resend a répondu {status}")))
        }
    }
}

fn reset_text(link: &str) -> String {
    format!(
        "Vous avez demandé à réinitialiser votre mot de passe Epick'em.\n\n\
         Ouvrez ce lien pour en choisir un nouveau (valable 15 minutes) :\n{link}\n\n\
         Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : \
         votre mot de passe reste inchangé."
    )
}

fn reset_html(link: &str) -> String {
    format!(
        "<p>Vous avez demandé à réinitialiser votre mot de passe Epick'em.</p>\
         <p><a href=\"{link}\">Choisir un nouveau mot de passe</a> (lien valable 15 minutes).</p>\
         <p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : \
         votre mot de passe reste inchangé.</p>"
    )
}

/// Resend n'est pas configuré : rien n'est envoyé.
pub struct NoopMailer;

#[async_trait]
impl Mailer for NoopMailer {
    async fn send_password_reset(&self, _to: &str, _link: &str) -> Result<(), MailError> {
        eprintln!("api-public : RESEND_API_KEY absente, e-mail de réinitialisation non envoyé");
        Ok(())
    }
}

/// Garde les messages envoyés, pour les tests.
#[derive(Default)]
pub struct MemoryMailer {
    sent: Mutex<Vec<(String, String)>>,
}

impl MemoryMailer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Couples (destinataire, lien) envoyés, dans l'ordre.
    pub fn sent(&self) -> Vec<(String, String)> {
        self.sent.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

#[async_trait]
impl Mailer for MemoryMailer {
    async fn send_password_reset(&self, to: &str, link: &str) -> Result<(), MailError> {
        self.sent
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push((to.to_string(), link.to_string()));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config(vars: &[(&str, &str)]) -> Option<MailConfig> {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        MailConfig::from_lookup(|name| vars.get(name).cloned())
    }

    #[test]
    fn sending_is_disabled_without_an_api_key() {
        assert!(config(&[]).is_none());
        assert!(config(&[("RESEND_API_KEY", "")]).is_none());
    }

    #[test]
    fn config_has_defaults_and_hides_the_key() {
        let config = config(&[("RESEND_API_KEY", "re_secret")]).unwrap();
        assert!(config.from.contains("resend.dev"));
        assert!(config.reset_url.ends_with("/reset-password"));
        assert!(!format!("{config:?}").contains("re_secret"));
        let config = self::config(&[
            ("RESEND_API_KEY", "k"),
            ("MAIL_FROM", "a@b.fr"),
            ("PASSWORD_RESET_URL", "epickem://reset"),
        ])
        .unwrap();
        assert_eq!(config.from, "a@b.fr");
        assert_eq!(config.reset_url, "epickem://reset");
    }

    #[test]
    fn message_announces_the_validity() {
        assert!(reset_text("l").contains("15 minutes"));
        assert!(reset_html("l").contains("15 minutes"));
    }

    #[test]
    fn link_appends_the_token() {
        assert_eq!(
            reset_link("https://x.fr/reset", "abc"),
            "https://x.fr/reset?token=abc"
        );
        assert_eq!(
            reset_link("https://x.fr/r?a=1", "abc"),
            "https://x.fr/r?a=1&token=abc"
        );
    }
}
