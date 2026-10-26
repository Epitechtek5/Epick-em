//! Spécification OpenAPI et Swagger UI.
//!
//! Pour ajouter un endpoint :
//! 1. annoter le handler avec `#[utoipa::path(...)]` (méthode, chemin, tag, réponses) ;
//! 2. les types de requête/réponse dérivent `utoipa::ToSchema` ;
//! 3. l'enregistrer avec `cfg.service(handler)` dans le `routes()` de son module, qui doit
//!    porter aussi l'attribut actix (`#[get("/chemin")]`, …) ; un nouveau module est ajouté
//!    à `router::api_routes`.
//!
//! Le chemin et le tag sont déduits de l'annotation : rien d'autre à déclarer ici. Un endpoint
//! protégé ajoute `security(("bearer" = []))` ; le test `spec_matches_route_policy` vérifie
//! qu'il est cohérent avec `guard::route_policy`.

use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Epick'em API publique",
        description = "API consommée par le web et le mobile. Servie sous `/api` derrière nginx.",
    ),
    servers((url = "/api", description = "Via nginx / proxy Vite")),
    tags(
        (name = "auth", description = "Inscription, connexion et jetons"),
        (name = "users", description = "Consultation et gestion des comptes"),
        (name = "games", description = "Consultation et administration des jeux"),
        (name = "stats", description = "Statistiques et leur liaison aux jeux"),
        (name = "teams", description = "Équipes globales et leurs membres"),
        (name = "tournament-teams", description = "Équipes de tournoi, copies indépendantes des équipes globales"),
        (name = "tournaments", description = "Tournois, barème, inscriptions, statuts et classements"),
        (name = "system", description = "Santé du service"),
    ),
    modifiers(&BearerAuth),
)]
pub struct ApiDoc;

struct BearerAuth;

impl Modify for BearerAuth {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .build(),
            ),
        );
    }
}
