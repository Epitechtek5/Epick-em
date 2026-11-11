//! Point d'entrée de api-public : se connecte à PostgreSQL et Redis, puis sert l'API HTTP.

use actix_web::HttpServer;
use api_public::config::AuthConfig;
use api_public::invitations::InvitationTtl;
use api_public::mail::{MailConfig, ResendMailer};
use api_public::store::PgStore;
use api_public::{AppState, app};
use std::error::Error;
use std::process::ExitCode;
use std::sync::Arc;

#[actix_web::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("api-public : {err}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), Box<dyn Error>> {
    let port = std::env::var("API_PUBLIC_PORT").unwrap_or_else(|_| "8080".into());
    let config = infra::Config::from_env()?;
    let auth_config = AuthConfig::from_env()?;
    let db = infra::connect(&config).await?;

    let cache = db.cache().clone();
    let store = Arc::new(PgStore::new(db));
    let state = AppState::new(store, auth_config)
        .map_err(|err| format!("initialisation du hachage de mots de passe : {err}"))?
        .with_cache(cache)
        .with_invitation_ttl(invitation_ttl()?);
    let state = match MailConfig::from_env() {
        Some(mail) => state.with_mailer(Arc::new(ResendMailer::new(&mail)?), &mail.public_url),
        None => {
            eprintln!("api-public : RESEND_API_KEY absente, les e-mails ne seront pas envoyés");
            state
        }
    };

    api_public::invitations::spawn_expiry_task(state.clone());
    let server = HttpServer::new(move || app(state.clone())).bind(format!("0.0.0.0:{port}"))?;
    println!(
        "api-public (domain {}) en écoute sur :{port}",
        domain::VERSION
    );
    server.run().await?;
    Ok(())
}

/// Validité des invitations : `INVITATION_DEFAULT_TTL_HOURS` (168 par défaut) et
/// `INVITATION_MAX_TTL_HOURS` (720 par défaut).
fn invitation_ttl() -> Result<InvitationTtl, Box<dyn Error>> {
    let hours = |name: &str, default: u64| -> Result<std::time::Duration, Box<dyn Error>> {
        let value = match std::env::var(name) {
            Ok(value) => value
                .parse::<u64>()
                .ok()
                .filter(|hours| *hours >= 1)
                .ok_or_else(|| format!("{name} doit être un nombre d'heures entier, au moins 1"))?,
            Err(_) => default,
        };
        Ok(std::time::Duration::from_secs(value * 3600))
    };
    let ttl = InvitationTtl {
        default: hours("INVITATION_DEFAULT_TTL_HOURS", 7 * 24)?,
        max: hours("INVITATION_MAX_TTL_HOURS", 30 * 24)?,
    };
    if ttl.default > ttl.max {
        return Err("INVITATION_DEFAULT_TTL_HOURS dépasse INVITATION_MAX_TTL_HOURS".into());
    }
    Ok(ttl)
}
