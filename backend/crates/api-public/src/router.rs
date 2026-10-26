//! Assemblage du routeur : routes des modules, garde d'authentification, Swagger UI.

use crate::auth::AppState;
use crate::openapi::ApiDoc;
use axum::Router;
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;
use utoipa_swagger_ui::{Config, SwaggerUi};

/// Chemin de l'interface Swagger UI.
pub const DOCS_PATH: &str = "/docs";
/// Chemin de la spécification OpenAPI (JSON).
pub const SPEC_PATH: &str = "/openapi.json";

/// Toutes les routes documentées ; y fusionner les routes des futurs modules.
fn api_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::with_openapi(ApiDoc::openapi())
        .routes(routes!(health))
        .routes(routes!(hello))
        .merge(crate::auth::routes())
}

/// Spécification OpenAPI complète, sans base de données ni serveur (génération des clients).
pub fn openapi() -> utoipa::openapi::OpenApi {
    api_routes().split_for_parts().1
}

/// Routeur et spécification, séparés pour pouvoir inspecter la spécification en test.
pub fn router_with_spec(state: AppState) -> (Router, utoipa::openapi::OpenApi) {
    let (router, spec) = api_routes().split_for_parts();
    let router = router
        .route_layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::guard::require_auth,
        ))
        .with_state(state)
        // Fusionné après la garde : la documentation est publique.
        // URL relative à la page : fonctionne aussi sous `/api/docs/` derrière nginx ou Vite.
        .merge(
            SwaggerUi::new(DOCS_PATH)
                .url(SPEC_PATH, spec.clone())
                .config(Config::from("../openapi.json")),
        );
    (router, spec)
}

pub fn router(state: AppState) -> Router {
    router_with_spec(state).0
}

/// Vérifie que le service répond.
#[utoipa::path(
    get,
    path = "/health",
    tag = "system",
    responses((status = 200, description = "Service opérationnel", body = String, example = "ok")),
)]
async fn health() -> &'static str {
    "ok"
}

#[utoipa::path(
    get,
    path = "/hello",
    tag = "system",
    responses((status = 200, description = "Message de bienvenue", body = String, example = "Hello, world!")),
)]
async fn hello() -> &'static str {
    "Hello, world!"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AuthConfig;
    use crate::guard::{RoutePolicy, route_policy};
    use crate::store::MemoryStore;
    use std::sync::Arc;
    use std::time::Duration;

    fn spec() -> utoipa::openapi::OpenApi {
        let config = AuthConfig {
            jwt_secret: "s".repeat(32),
            access_token_ttl: Duration::from_secs(60),
            refresh_token_ttl: Duration::from_secs(60),
        };
        let state = AppState::new(Arc::new(MemoryStore::new()), config).unwrap();
        router_with_spec(state).1
    }

    /// Chaque opération déclare `security` si et seulement si la garde exige un jeton.
    #[test]
    fn spec_matches_route_policy() {
        let spec = spec();
        assert!(!spec.paths.paths.is_empty());
        for (path, item) in &spec.paths.paths {
            let operations = [
                ("GET", &item.get),
                ("POST", &item.post),
                ("PUT", &item.put),
                ("PATCH", &item.patch),
                ("DELETE", &item.delete),
            ];
            for (method, op) in operations {
                let Some(op) = op else { continue };
                let protected = route_policy(path) != RoutePolicy::Public;
                let documented = op.security.as_ref().is_some_and(|s| !s.is_empty());
                assert_eq!(
                    documented, protected,
                    "{method} {path} : `security` incohérent avec guard::route_policy"
                );
                assert!(!op.responses.responses.is_empty(), "{method} {path}");
                assert!(op.tags.is_some(), "{method} {path} : tag manquant");
            }
        }
    }
}
