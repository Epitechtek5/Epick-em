//! Mot de passe oublié : demande d'un lien par e-mail, puis choix d'un nouveau mot de passe.
//!
//! - le jeton est une chaîne aléatoire opaque envoyée par e-mail ; seule son empreinte SHA-256
//!   est stockée. Il est à usage unique et valable [`RESET_TOKEN_TTL`] ;
//! - une nouvelle demande invalide les jetons encore en attente du compte ;
//! - `/forgot-password` répond toujours 204 pour ne pas révéler quelles adresses ont un compte ;
//! - changer le mot de passe révoque tous les jetons de rafraîchissement du compte.

use crate::auth::{AppState, hash_password_blocking, hash_token, new_token, password_error};
use crate::error::{ApiError, ErrorResponse};
use crate::mail::reset_link;
use actix_web::{HttpResponse, post, web};
use serde::Deserialize;
use std::time::Duration;
use utoipa::ToSchema;
use utoipa_actix_web::service_config::ServiceConfig;

/// Durée de validité d'un lien de réinitialisation.
pub const RESET_TOKEN_TTL: Duration = Duration::from_secs(60 * 60);
pub const EMAIL_MAX: usize = 254;

/// Routes de réinitialisation du mot de passe, avec leur documentation OpenAPI.
pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(forgot_password).service(reset_password);
}

#[derive(Deserialize, ToSchema)]
struct ForgotPasswordRequest {
    #[schema(max_length = 254, format = Email, example = "alice@example.com")]
    email: String,
}

#[derive(Deserialize, ToSchema)]
struct ResetPasswordRequest {
    /// Jeton reçu dans le lien envoyé par e-mail.
    token: String,
    #[schema(min_length = 8, max_length = 128, format = Password)]
    password: String,
}

/// Message d'erreur si `email` n'a pas la forme d'une adresse e-mail (`local@domaine.tld`).
pub(crate) fn email_error(email: &str) -> Option<String> {
    let valid = email.chars().count() <= EMAIL_MAX
        && !email.chars().any(|c| c.is_whitespace() || c.is_control())
        && email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty()
                && !domain.contains('@')
                && domain.split('.').count() >= 2
                && domain.split('.').all(|label| !label.is_empty())
        });
    (!valid).then(|| "Saisissez une adresse e-mail valide.".to_string())
}

/// Forme stockée et comparée : sans espaces autour, en minuscules.
pub(crate) fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

/// Envoie un lien de réinitialisation à l'adresse du compte.
///
/// Répond 204 que l'adresse corresponde à un compte ou non.
#[utoipa::path(
    post,
    path = "/forgot-password",
    tag = "auth",
    request_body = ForgotPasswordRequest,
    responses(
        (status = 204, description = "Si un compte utilise cette adresse, un e-mail vient de lui être envoyé"),
        (status = 400, description = "Adresse e-mail invalide", body = ErrorResponse),
    ),
)]
#[post("/forgot-password")]
async fn forgot_password(
    state: web::Data<AppState>,
    request: web::Json<ForgotPasswordRequest>,
) -> Result<HttpResponse, ApiError> {
    let email = normalize_email(&request.email);
    if let Some(message) = email_error(&email) {
        return Err(ApiError::Validation(vec![("email", message)]));
    }
    let user = state
        .store
        .find_user_by_email(&email)
        .await
        .map_err(ApiError::internal)?;
    if let Some(user) = user {
        let token = new_token();
        state
            .store
            .insert_password_reset_token(user.id, &hash_token(&token), RESET_TOKEN_TTL)
            .await
            .map_err(ApiError::internal)?;
        let link = reset_link(&state.reset_url, &token);
        let mailer = state.mailer.clone();
        // En tâche de fond : la durée de la réponse ne dépend pas de l'existence du compte, et
        // une panne de Resend ne change pas la réponse (elle est seulement journalisée).
        actix_web::rt::spawn(async move {
            if let Err(err) = mailer.send_password_reset(&email, &link).await {
                eprintln!("api-public : envoi de l'e-mail de réinitialisation : {err}");
            }
        });
    }
    Ok(HttpResponse::NoContent().finish())
}

/// Choisit un nouveau mot de passe à partir du jeton reçu par e-mail.
///
/// Les sessions ouvertes sont déconnectées (jetons de rafraîchissement révoqués).
#[utoipa::path(
    post,
    path = "/reset-password",
    tag = "auth",
    request_body = ResetPasswordRequest,
    responses(
        (status = 204, description = "Mot de passe changé"),
        (status = 400, description = "Mot de passe invalide, ou jeton inconnu, expiré ou déjà utilisé", body = ErrorResponse),
    ),
)]
#[post("/reset-password")]
async fn reset_password(
    state: web::Data<AppState>,
    request: web::Json<ResetPasswordRequest>,
) -> Result<HttpResponse, ApiError> {
    let ResetPasswordRequest { token, password } = request.into_inner();
    if let Some(message) = password_error(&password) {
        return Err(ApiError::Validation(vec![("password", message)]));
    }
    let password_hash = hash_password_blocking(password).await?;
    let consumed = state
        .store
        .consume_password_reset_token(&hash_token(&token), &password_hash)
        .await
        .map_err(ApiError::internal)?;
    if consumed {
        Ok(HttpResponse::NoContent().finish())
    } else {
        Err(ApiError::InvalidResetToken)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_shape() {
        for ok in ["a@b.fr", "alice.martin+epickem@mail.example.com"] {
            assert_eq!(email_error(ok), None, "{ok}");
        }
        for bad in [
            "", "alice", "@b.fr", "a@", "a@b", "a@b.", "a@.fr", "a@@b.fr", "a b@c.fr", "a@b..fr",
        ] {
            assert!(email_error(bad).is_some(), "{bad}");
        }
        assert!(email_error(&format!("{}@b.fr", "a".repeat(250))).is_some());
    }

    #[test]
    fn email_is_trimmed_and_lowercased() {
        assert_eq!(normalize_email("  Alice@Example.COM "), "alice@example.com");
    }
}
