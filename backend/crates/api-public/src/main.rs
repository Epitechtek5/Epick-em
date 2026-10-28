//! Point d'entrée de api-public : se connecte à PostgreSQL et Redis, puis sert l'API HTTP.

use actix_web::HttpServer;
use api_public::config::AuthConfig;
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

    let store = Arc::new(PgStore::new(db));
    let state = AppState::new(store, auth_config)
        .map_err(|err| format!("initialisation du hachage de mots de passe : {err}"))?;
    let state = match MailConfig::from_env() {
        Some(mail) => state.with_mailer(Arc::new(ResendMailer::new(&mail)?), &mail.reset_url),
        None => {
            eprintln!("api-public : RESEND_API_KEY absente, les e-mails ne seront pas envoyés");
            state
        }
    };

    let server = HttpServer::new(move || app(state.clone())).bind(format!("0.0.0.0:{port}"))?;
    println!(
        "api-public (domain {}) en écoute sur :{port}",
        domain::VERSION
    );
    server.run().await?;
    Ok(())
}
