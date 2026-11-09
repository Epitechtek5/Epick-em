//! Middleware d'authentification : exige un jeton d'accès `Bearer` sur toutes les routes qui
//! ne sont pas explicitement publiques.

use crate::auth::{AppState, decode_access_token, decode_access_token_ignoring_expiry};
use crate::error::ApiError;
use actix_web::body::BoxBody;
use actix_web::dev::{ServiceRequest, ServiceResponse};
use actix_web::http::header::{self, HeaderMap};
use actix_web::middleware::Next;
use actix_web::{Error, HttpMessage, ResponseError, web};

/// Exigence d'authentification d'une route.
#[derive(Debug, PartialEq, Eq)]
pub enum RoutePolicy {
    /// Aucun jeton requis.
    Public,
    /// Jeton d'accès valide (signature et expiration).
    Authenticated,
    /// Jeton d'accès à la signature valide ; l'expiration est tolérée.
    SignatureOnly,
}

/// Par défaut une route est protégée : une nouvelle route doit être listée ici pour être publique.
/// La documentation OpenAPI (`/docs`, `/openapi.json`) est publique.
pub fn route_policy(path: &str) -> RoutePolicy {
    match path {
        "/register" | "/login" | "/forgot-password" | "/reset-password" | "/hello" | "/health"
        | "/openapi.json" => RoutePolicy::Public,
        "/docs" => RoutePolicy::Public,
        _ if path.starts_with("/docs/") => RoutePolicy::Public,
        "/refresh" => RoutePolicy::SignatureOnly,
        _ => RoutePolicy::Authenticated,
    }
}

/// Place les [`Claims`](crate::auth::Claims) du jeton dans les extensions de la requête.
pub async fn require_auth(
    req: ServiceRequest,
    next: Next<BoxBody>,
) -> Result<ServiceResponse<BoxBody>, Error> {
    let policy = route_policy(req.path());
    // Un chemin inconnu reste un 404, que l'appelant soit authentifié ou non.
    if policy == RoutePolicy::Public || !req.resource_map().has_resource(req.path()) {
        return next.call(req).await;
    }
    let Some(state) = req.app_data::<web::Data<AppState>>() else {
        return Ok(req.into_response(ApiError::internal("AppState absent").error_response()));
    };
    let secret = &state.config.jwt_secret;
    let claims = bearer_token(req.headers()).and_then(|token| match policy {
        RoutePolicy::SignatureOnly => decode_access_token_ignoring_expiry(token, secret),
        _ => decode_access_token(token, secret),
    });
    match claims {
        Some(claims) => {
            req.extensions_mut().insert(claims);
            next.call(req).await
        }
        None => Ok(req.into_response(ApiError::Unauthorized.error_response())),
    }
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    (scheme.eq_ignore_ascii_case("bearer") && !token.is_empty()).then_some(token.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policies() {
        for path in [
            "/register",
            "/login",
            "/forgot-password",
            "/reset-password",
            "/hello",
            "/health",
            "/openapi.json",
            "/docs",
            "/docs/",
            "/docs/swagger-ui.css",
        ] {
            assert_eq!(route_policy(path), RoutePolicy::Public, "{path}");
        }
        assert_eq!(route_policy("/refresh"), RoutePolicy::SignatureOnly);
        assert_eq!(route_policy("/logout"), RoutePolicy::Authenticated);
        assert_eq!(route_policy("/users"), RoutePolicy::Authenticated);
        assert_eq!(route_policy("/autre"), RoutePolicy::Authenticated);
        assert_eq!(route_policy("/documents"), RoutePolicy::Authenticated);
    }

    #[test]
    fn bearer_parsing() {
        let headers = |v: &str| {
            let mut h = HeaderMap::new();
            h.insert(header::AUTHORIZATION, v.parse().unwrap());
            h
        };
        assert_eq!(bearer_token(&headers("Bearer abc")), Some("abc"));
        assert_eq!(bearer_token(&headers("bearer abc")), Some("abc"));
        assert_eq!(bearer_token(&headers("Basic abc")), None);
        assert_eq!(bearer_token(&headers("Bearer ")), None);
        assert_eq!(bearer_token(&headers("abc")), None);
        assert_eq!(bearer_token(&HeaderMap::new()), None);
    }
}
