//! API publique : tout ce que le front web et le mobile appellent (voir ADR-002).

pub mod auth;
pub mod error;
mod password;
pub mod users;

use actix_web::web;
use error::ApiError;

/// Enregistre toutes les routes de l'API ; le `PgPool` est fourni par l'appelant en `app_data`.
pub fn configure(cfg: &mut web::ServiceConfig) {
    // Corps JSON ou identifiant invalide : même format d'erreur que les handlers.
    cfg.app_data(web::JsonConfig::default().error_handler(|err, _| {
        ApiError::BadRequest(format!("corps JSON invalide : {err}")).into()
    }))
    .app_data(web::PathConfig::default().error_handler(|_, _| ApiError::NotFound.into()))
    .configure(users::configure);
}
