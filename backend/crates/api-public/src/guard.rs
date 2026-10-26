//! Middleware d'authentification : exige un jeton d'accès `Bearer` sur toutes les routes qui
//! ne sont pas explicitement publiques.

use crate::auth::{AppState, decode_access_token, decode_access_token_ignoring_expiry};
use crate::error::ApiError;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, header};
use axum::middleware::Next;
use axum::response::Response;

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
pub fn route_policy(path: &str) -> RoutePolicy {
    match path {
        "/register" | "/login" | "/hello" | "/health" => RoutePolicy::Public,
        "/refresh" => RoutePolicy::SignatureOnly,
        _ => RoutePolicy::Authenticated,
    }
}

/// Place les [`Claims`](crate::auth::Claims) du jeton dans les extensions de la requête.
pub async fn require_auth(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let policy = route_policy(request.uri().path());
    if policy == RoutePolicy::Public {
        return Ok(next.run(request).await);
    }
    let token = bearer_token(request.headers()).ok_or(ApiError::Unauthorized)?;
    let secret = &state.config.jwt_secret;
    let claims = match policy {
        RoutePolicy::SignatureOnly => decode_access_token_ignoring_expiry(token, secret),
        _ => decode_access_token(token, secret),
    }
    .ok_or(ApiError::Unauthorized)?;
    request.extensions_mut().insert(claims);
    Ok(next.run(request).await)
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
        for path in ["/register", "/login", "/hello", "/health"] {
            assert_eq!(route_policy(path), RoutePolicy::Public, "{path}");
        }
        assert_eq!(route_policy("/refresh"), RoutePolicy::SignatureOnly);
        assert_eq!(route_policy("/logout"), RoutePolicy::Authenticated);
        assert_eq!(route_policy("/autre"), RoutePolicy::Authenticated);
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
