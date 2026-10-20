//! Identification de l'utilisateur à l'origine d'une requête.
//!
//! PROVISOIRE : l'identifiant est lu dans l'en-tête `X-User-Id`, sans aucune preuve
//! d'identité. N'importe quel client peut donc se faire passer pour un administrateur.
//! Cette implémentation sera remplacée par la validation du JWT (#15) ; les handlers
//! n'utilisent que `CurrentUser` et n'auront pas à changer.

use crate::error::ApiError;
use actix_web::{FromRequest, HttpRequest, dev::Payload, web};
use domain::user::Role;
use sqlx::PgPool;
use std::future::Future;
use std::pin::Pin;

pub const USER_ID_HEADER: &str = "X-User-Id";

/// Utilisateur authentifié, chargé depuis la base à chaque requête.
#[derive(Debug, Clone, Copy)]
pub struct CurrentUser {
    pub id: i64,
    pub role: Role,
}

impl CurrentUser {
    pub fn require_admin(&self) -> Result<(), ApiError> {
        if self.role == Role::Admin {
            Ok(())
        } else {
            Err(ApiError::Forbidden)
        }
    }
}

impl FromRequest for CurrentUser {
    type Error = ApiError;
    type Future = Pin<Box<dyn Future<Output = Result<Self, Self::Error>>>>;

    fn from_request(req: &HttpRequest, _: &mut Payload) -> Self::Future {
        let id = req
            .headers()
            .get(USER_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<i64>().ok());
        let pool = req.app_data::<web::Data<PgPool>>().cloned();

        Box::pin(async move {
            let id = id.ok_or(ApiError::Unauthorized)?;
            let pool = pool.ok_or(ApiError::Internal)?;
            let role: Option<String> = sqlx::query_scalar(
                "SELECT r.name::text FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1",
            )
            .bind(id)
            .fetch_optional(pool.get_ref())
            .await?;
            // Un identifiant inconnu (compte supprimé, par exemple) n'authentifie personne.
            let role = role
                .as_deref()
                .and_then(Role::parse)
                .ok_or(ApiError::Unauthorized)?;
            Ok(CurrentUser { id, role })
        })
    }
}
