//! Assemblage de l'application : routes des modules, garde d'authentification, Swagger UI.

use crate::auth::AppState;
use crate::error::ApiError;
use crate::guard::require_auth;
use crate::openapi::ApiDoc;
use actix_web::body::MessageBody;
use actix_web::dev::{ServiceFactory, ServiceRequest, ServiceResponse};
use actix_web::middleware::from_fn;
use actix_web::{App, Error, get, web};
use utoipa::OpenApi;
use utoipa_actix_web::AppExt;
use utoipa_actix_web::service_config::ServiceConfig;
use utoipa_swagger_ui::{Config, SwaggerUi};

/// Chemin de l'interface Swagger UI.
pub const DOCS_PATH: &str = "/docs";
/// Chemin de la spécification OpenAPI (JSON).
pub const SPEC_PATH: &str = "/openapi.json";

/// Toutes les routes documentées ; y ajouter les routes des futurs modules.
fn api_routes(cfg: &mut ServiceConfig) {
    cfg.service(health)
        .service(hello)
        .configure(crate::auth::routes)
        .configure(crate::password_reset::routes)
        .configure(crate::users::routes);
}

/// Spécification OpenAPI complète, sans base de données ni serveur (génération des clients).
pub fn openapi() -> utoipa::openapi::OpenApi {
    App::new()
        .into_utoipa_app()
        .openapi(ApiDoc::openapi())
        .configure(api_routes)
        .split_for_parts()
        .1
}

/// L'application complète, à servir avec `HttpServer::new(move || app(state.clone()))`.
pub fn app(
    state: AppState,
) -> App<
    impl ServiceFactory<
        ServiceRequest,
        Config = (),
        Response = ServiceResponse<impl MessageBody>,
        Error = Error,
        InitError = (),
    >,
> {
    let (app, spec) = App::new()
        .app_data(web::Data::new(state))
        // Corps JSON, identifiant ou paramètres invalides : même format d'erreur que les handlers.
        .app_data(web::JsonConfig::default().error_handler(|err, _| ApiError::from(err).into()))
        .app_data(web::PathConfig::default().error_handler(|_, _| ApiError::NotFound.into()))
        .app_data(
            web::QueryConfig::default()
                .error_handler(|_, _| ApiError::Validation(Vec::new()).into()),
        )
        .into_utoipa_app()
        .openapi(ApiDoc::openapi())
        .configure(api_routes)
        .split_for_parts();
    app.wrap(from_fn(require_auth)).service(
        // URL relative à la page : fonctionne aussi sous `/api/docs/` derrière nginx ou Vite.
        SwaggerUi::new(format!("{DOCS_PATH}/{{_:.*}}"))
            .url(SPEC_PATH, spec)
            .config(Config::from("../openapi.json")),
    )
}

/// Vérifie que le service répond.
#[utoipa::path(
    get,
    path = "/health",
    tag = "system",
    responses((status = 200, description = "Service opérationnel", body = String, example = "ok")),
)]
#[get("/health")]
async fn health() -> &'static str {
    "ok"
}

#[utoipa::path(
    get,
    path = "/hello",
    tag = "system",
    responses((status = 200, description = "Message de bienvenue", body = String, example = "Hello, world!")),
)]
#[get("/hello")]
async fn hello() -> &'static str {
    "Hello, world!"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::guard::{RoutePolicy, route_policy};

    /// Chaque opération déclare `security` si et seulement si la garde exige un jeton.
    #[test]
    fn spec_matches_route_policy() {
        let spec = openapi();
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
