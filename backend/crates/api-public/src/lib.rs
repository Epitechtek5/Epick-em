//! API publique : authentification (inscription, connexion, rafraîchissement, déconnexion),
//! gestion des comptes, des jeux, des statistiques, des équipes et des tournois.
//! La documentation OpenAPI est servie sur `/docs` (Swagger UI) et `/openapi.json`.
//!
//! Les routes sont exposées sans préfixe : le front les appelle en `/api/*` et nginx (ou le
//! proxy Vite) retire le préfixe.

pub mod auth;
pub mod config;
pub mod error;
pub mod export_cache;
pub mod game_io;
pub mod games;
pub mod guard;
pub mod match_io;
pub mod matches;
pub mod openapi;
pub mod ranking;
pub mod router;
pub mod stat_io;
pub mod stats;
pub mod step_io;
pub mod steps;
pub mod store;
pub mod team_io;
pub mod teams;
pub mod tournament_io;
pub mod tournament_team_io;
pub mod tournament_teams;
pub mod tournaments;
pub mod users;

pub use auth::AppState;
pub use router::app;
