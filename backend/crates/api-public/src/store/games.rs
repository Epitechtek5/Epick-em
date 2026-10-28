//! Types des jeux (table `games`).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Game {
    pub id: Uuid,
    #[schema(example = "League of Legends")]
    pub name: String,
    pub description: String,
    /// URLs des images ; la première sert de visuel principal.
    pub images: Vec<String>,
}

/// Jeu à créer.
#[derive(Debug, Clone)]
pub struct GameInput {
    pub name: String,
    pub description: String,
    pub images: Vec<String>,
}

/// Modification partielle d'un jeu : seuls les champs renseignés changent.
#[derive(Debug, Default, Clone)]
pub struct GameUpdate {
    pub name: Option<String>,
    pub description: Option<String>,
    pub images: Option<Vec<String>>,
}
