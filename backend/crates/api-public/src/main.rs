//! Point d'entrée de api-public : se connecte à PostgreSQL et Redis, puis sert l'API HTTP.

use actix_web::HttpServer;
use api_public::config::{AuthConfig, SecurityConfig};
use api_public::invitations::{EngineInvitationNotifier, InvitationTtl};
use api_public::mail::{MailConfig, ResendMailer, public_url_from_env};
use api_public::projection::StoreProjector;
use api_public::push::ExpoPush;
use api_public::store::PgStore;
use api_public::{AppState, app};
use connectors::sync::{RedisSyncStore, SyncPolicy, SyncService};
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
    let security_config = SecurityConfig::from_env()?;
    let db = infra::connect(&config).await?;

    let cache = db.cache().clone();
    let registry = connectors::registry_from_env(Some(cache.clone()))?;
    let store = Arc::new(PgStore::new(db.clone()));
    // Chaque instantané importé est reporté dans le tournoi local (inscrits, étapes, matchs).
    // L'état de synchronisation et le tournoi importé vivent dans Redis ; la base ne garde que
    // le lien source ↔ tournoi.
    let redis = infra::RedisCache::connect(&config.redis_url).await?;
    let sync = Arc::new(
        SyncService::new(
            registry,
            Arc::new(RedisSyncStore::new(db.clone(), redis.connection())),
            SyncPolicy::default(),
        )
        .with_projector(Arc::new(StoreProjector::new(store.clone()))),
    );
    let state = AppState::new(store, auth_config)
        .map_err(|err| format!("initialisation du hachage de mots de passe : {err}"))?
        .with_cache(cache)
        .with_public_url(&public_url_from_env())
        .with_invitation_ttl(invitation_ttl()?)
        .with_sync(sync);
    if security_config.google.is_none() {
        eprintln!("api-public : GOOGLE_CLIENT_ID absente, la connexion Google est désactivée");
    }
    if security_config.totp_key.is_none() {
        eprintln!(
            "api-public : TOTP_ENCRYPTION_KEY absente, la double authentification est désactivée"
        );
    }
    let state = state.with_security(security_config)?;
    let state = match MailConfig::from_env() {
        Some(mail) => state.with_mailer(Arc::new(ResendMailer::new(&mail)?), &mail.public_url),
        None => {
            eprintln!("api-public : RESEND_API_KEY absente, les e-mails ne seront pas envoyés");
            state
        }
    };

    let state = match ExpoPush::from_env() {
        Some(push) => state.with_push(Arc::new(push?)),
        None => {
            eprintln!("api-public : PUSH_ENABLED absente, les notifications push seront ignorées");
            state
        }
    };
    let notifier = Arc::new(EngineInvitationNotifier::from_state(&state));
    let state = state.with_invitation_notifier(notifier);
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
