//! API publique : authentification (inscription, connexion, rafraîchissement, déconnexion),
//! gestion des comptes, des jeux et des statistiques.
//! La documentation OpenAPI est servie sur `/docs` (Swagger UI) et `/openapi.json`.
//!
//! Les routes sont exposées sans préfixe : le front les appelle en `/api/*` et nginx (ou le
//! proxy Vite) retire le préfixe.

pub mod auth;
pub mod config;
pub mod error;
pub mod game_io;
pub mod games;
pub mod guard;
pub mod openapi;
pub mod router;
pub mod stat_io;
pub mod stats;
pub mod store;
pub mod users;

pub use auth::AppState;
pub use router::app;
