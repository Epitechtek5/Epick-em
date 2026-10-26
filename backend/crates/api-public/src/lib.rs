//! API publique : authentification (inscription, connexion, rafraîchissement, déconnexion) et
//! gestion des comptes.
//! La documentation OpenAPI est servie sur `/docs` (Swagger UI) et `/openapi.json`.
//!
//! Les routes sont exposées sans préfixe : le front les appelle en `/api/*` et nginx (ou le
//! proxy Vite) retire le préfixe.

pub mod auth;
pub mod config;
pub mod error;
pub mod guard;
pub mod openapi;
pub mod router;
pub mod store;
pub mod users;

pub use auth::AppState;
pub use router::app;
