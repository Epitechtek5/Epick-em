//! Transactional email for account creation, verification and password recovery.
//!
//! [`ResendMailer`] passe par l'API HTTP de Resend en production ; [`MemoryMailer`] garde les
//! messages en mémoire pour les tests, et [`NoopMailer`] sert quand Resend n'est pas configuré.

use crate::store::{Category, Language};
use async_trait::async_trait;
use serde_json::json;
use std::fmt;
use std::sync::Mutex;
use std::time::Duration;

const RESEND_ENDPOINT: &str = "https://api.resend.com/emails";
const SEND_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_PASSWORD_RESET_TEMPLATE: &str = "password-reset";

#[derive(Debug)]
pub struct MailError(String);

impl fmt::Display for MailError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for MailError {}

/// Notification optionnelle à envoyer par e-mail, déjà rédigée dans la langue du destinataire.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotificationMail {
    pub language: Language,
    pub category: Category,
    pub title: String,
    pub body: String,
    /// Lien absolu vers la page concernée, s'il y en a une.
    pub action_url: Option<String>,
}

#[async_trait]
pub trait Mailer: Send + Sync {
    fn available(&self) -> bool {
        true
    }
    async fn send_verification(&self, to: &str, link: &str) -> Result<(), MailError>;
    async fn send_welcome(&self, to: &str, username: &str) -> Result<(), MailError>;
    /// Envoie à `to` le message qui contient `link`, le lien de réinitialisation du mot de passe.
    async fn send_password_reset(&self, to: &str, link: &str) -> Result<(), MailError>;
    /// Envoie une notification du moteur (`notifications`) ; jamais utilisée pour les e-mails
    /// de sécurité ci-dessus.
    async fn send_notification(&self, to: &str, mail: &NotificationMail) -> Result<(), MailError>;
}

/// Configuration de l'envoi, lue dans l'environnement (voir `.env.example`).
#[derive(Clone)]
pub struct MailConfig {
    pub api_key: String,
    /// Expéditeur, sur un domaine vérifié chez Resend (ex. `Epick'em <no-reply@epickem.app>`).
    pub from: String,
    /// Origine publique du site (ex. `https://epickem.app`), sans chemin : les liens des
    /// e-mails en sont déduits.
    pub public_url: String,
    /// Published Resend template ID or alias.
    pub password_reset_template: String,
    pub verification_template: String,
    pub welcome_template: String,
    /// Modèles Resend des notifications, un par langue : `fr`, `en`, `es`.
    pub notification_templates: [String; 3],
}

// Écrit à la main pour ne jamais journaliser la clé d'API.
impl fmt::Debug for MailConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MailConfig")
            .field("api_key", &"<masqué>")
            .field("from", &self.from)
            .field("public_url", &self.public_url)
            .field("password_reset_template", &self.password_reset_template)
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
            public_url: get("PUBLIC_URL").unwrap_or_else(|| "http://localhost:3000".into()),
            verification_template: get("RESEND_EMAIL_VERIFICATION_TEMPLATE")
                .unwrap_or_else(|| "email-address-confirmation".into()),
            welcome_template: get("RESEND_WELCOME_TEMPLATE")
                .unwrap_or_else(|| "welcome-account".into()),
            notification_templates: [
                get("RESEND_NOTIFICATION_TEMPLATE_FR").unwrap_or_else(|| "notification-fr".into()),
                get("RESEND_NOTIFICATION_TEMPLATE_EN").unwrap_or_else(|| "notification-en".into()),
                get("RESEND_NOTIFICATION_TEMPLATE_ES").unwrap_or_else(|| "notification-es".into()),
            ],
            password_reset_template: get("RESEND_PASSWORD_RESET_TEMPLATE")
                .unwrap_or_else(|| DEFAULT_PASSWORD_RESET_TEMPLATE.into()),
        })
    }
}

/// Route de la page (web, ou app mobile via les liens universels) qui reçoit le jeton.
pub const RESET_PATH: &str = "/reset-password";

/// Lien envoyé par e-mail : l'origine du site, [`RESET_PATH`] et le jeton (hexadécimal, donc
/// sans échappement).
pub fn reset_link(public_url: &str, token: &str) -> String {
    format!(
        "{}{RESET_PATH}?token={token}",
        public_url.trim_end_matches('/')
    )
}

pub struct ResendMailer {
    client: reqwest::Client,
    api_key: String,
    from: String,
    template: String,
    verification_template: String,
    welcome_template: String,
    notification_templates: [String; 3],
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
            verification_template: config.verification_template.clone(),
            welcome_template: config.welcome_template.clone(),
            template: config.password_reset_template.clone(),
            notification_templates: config.notification_templates.clone(),
            endpoint: endpoint.to_string(),
        })
    }
}

impl ResendMailer {
    async fn send_template(
        &self,
        to: &str,
        template: &str,
        variables: serde_json::Value,
    ) -> Result<(), MailError> {
        self.send_message(to, template, variables, None).await
    }

    async fn send_message(
        &self,
        to: &str,
        template: &str,
        variables: serde_json::Value,
        subject: Option<&str>,
    ) -> Result<(), MailError> {
        let mut message = json!({
            "from": self.from,
            "to": [to],
            "template": {
                "id": template,
                "variables": variables,
            },
        });
        if let Some(subject) = subject {
            message["subject"] = json!(subject);
        }
        let response = self
            .client
            .post(&self.endpoint)
            .bearer_auth(&self.api_key)
            .json(&message)
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

#[async_trait]
impl Mailer for ResendMailer {
    async fn send_password_reset(&self, to: &str, link: &str) -> Result<(), MailError> {
        self.send_template(to, &self.template, json!({"RESET_URL":link}))
            .await
    }
    async fn send_verification(&self, to: &str, link: &str) -> Result<(), MailError> {
        self.send_template(
            to,
            &self.verification_template,
            json!({"VERIFICATION_URL":link}),
        )
        .await
    }
    async fn send_welcome(&self, to: &str, username: &str) -> Result<(), MailError> {
        self.send_template(to, &self.welcome_template, json!({"USERNAME":username}))
            .await
    }
    async fn send_notification(&self, to: &str, mail: &NotificationMail) -> Result<(), MailError> {
        let template = &self.notification_templates[match mail.language {
            Language::Fr => 0,
            Language::En => 1,
            Language::Es => 2,
        }];
        self.send_message(
            to,
            template,
            notification_variables(mail),
            Some(&mail.title),
        )
        .await
    }
}

/// Variables transmises aux modèles Resend de notification (voir `docs/notifications.md`).
pub fn notification_variables(mail: &NotificationMail) -> serde_json::Value {
    json!({
        "TITLE": mail.title,
        "BODY": mail.body,
        "CATEGORY": mail.category.as_str(),
        "LANGUAGE": mail.language.as_str(),
        "ACTION_URL": mail.action_url.as_deref().unwrap_or_default(),
        "HAS_ACTION": mail.action_url.is_some(),
    })
}

/// Resend n'est pas configuré : rien n'est envoyé.
pub struct NoopMailer;

#[async_trait]
impl Mailer for NoopMailer {
    fn available(&self) -> bool {
        false
    }
    async fn send_verification(&self, _to: &str, _link: &str) -> Result<(), MailError> {
        Err(MailError("Mailer unavailable".into()))
    }
    async fn send_welcome(&self, _to: &str, _username: &str) -> Result<(), MailError> {
        Err(MailError("Mailer unavailable".into()))
    }
    async fn send_password_reset(&self, _to: &str, _link: &str) -> Result<(), MailError> {
        eprintln!("api-public : RESEND_API_KEY absente, e-mail de réinitialisation non envoyé");
        Ok(())
    }
    async fn send_notification(
        &self,
        _to: &str,
        _mail: &NotificationMail,
    ) -> Result<(), MailError> {
        Err(MailError("Mailer unavailable".into()))
    }
}

/// Garde les messages envoyés, pour les tests.
#[derive(Default)]
pub struct MemoryMailer {
    pub verification: Mutex<Vec<(String, String)>>,
    pub welcome: Mutex<Vec<(String, String)>>,
    sent: Mutex<Vec<(String, String)>>,
    notifications: Mutex<Vec<(String, NotificationMail)>>,
    /// Nombre d'envois de notification à refuser avant d'en accepter (tests de reprise).
    pub notification_failures: Mutex<usize>,
}

impl MemoryMailer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Notifications envoyées, dans l'ordre.
    pub fn notifications(&self) -> Vec<(String, NotificationMail)> {
        self.notifications
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Couples (destinataire, lien) envoyés, dans l'ordre.
    pub fn sent(&self) -> Vec<(String, String)> {
        self.sent.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

#[async_trait]
impl Mailer for MemoryMailer {
    async fn send_verification(&self, to: &str, link: &str) -> Result<(), MailError> {
        self.verification
            .lock()
            .unwrap()
            .push((to.into(), link.into()));
        Ok(())
    }
    async fn send_welcome(&self, to: &str, username: &str) -> Result<(), MailError> {
        self.welcome
            .lock()
            .unwrap()
            .push((to.into(), username.into()));
        Ok(())
    }
    async fn send_password_reset(&self, to: &str, link: &str) -> Result<(), MailError> {
        self.sent
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push((to.to_string(), link.to_string()));
        Ok(())
    }
    async fn send_notification(&self, to: &str, mail: &NotificationMail) -> Result<(), MailError> {
        {
            let mut failures = self
                .notification_failures
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if *failures > 0 {
                *failures -= 1;
                return Err(MailError("échec simulé".into()));
            }
        }
        self.notifications
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push((to.to_string(), mail.clone()));
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
        assert_eq!(config.public_url, "http://localhost:3000");
        assert_eq!(config.password_reset_template, "password-reset");
        assert!(!format!("{config:?}").contains("re_secret"));
        let config = self::config(&[
            ("RESEND_API_KEY", "k"),
            ("MAIL_FROM", "a@b.fr"),
            ("PUBLIC_URL", "https://epickem.app"),
        ])
        .unwrap();
        assert_eq!(config.from, "a@b.fr");
        assert_eq!(config.public_url, "https://epickem.app");
        let custom = self::config(&[
            ("RESEND_API_KEY", "k"),
            ("RESEND_PASSWORD_RESET_TEMPLATE", "custom-reset"),
        ])
        .unwrap();
        assert_eq!(custom.password_reset_template, "custom-reset");
    }

    #[test]
    fn link_appends_the_token() {
        assert_eq!(
            reset_link("https://x.fr", "abc"),
            "https://x.fr/reset-password?token=abc"
        );
        assert_eq!(
            reset_link("https://x.fr/", "abc"),
            "https://x.fr/reset-password?token=abc"
        );
    }
}
