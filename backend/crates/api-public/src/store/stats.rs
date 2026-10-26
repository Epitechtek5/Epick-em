//! Types des statistiques (tables `stats` et `stat_game`).

use serde::{Deserialize, Serialize};
use std::str::FromStr;
use utoipa::ToSchema;
use uuid::Uuid;

use super::StoreError;

/// Nature de la valeur d'une statistique.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum StatType {
    /// Valeur brute (kills, placement...).
    Flat,
    /// Pourcentage.
    Percent,
}

impl StatType {
    pub fn as_str(self) -> &'static str {
        match self {
            StatType::Flat => "flat",
            StatType::Percent => "percent",
        }
    }
}

impl FromStr for StatType {
    type Err = StoreError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "flat" => Ok(StatType::Flat),
            "percent" => Ok(StatType::Percent),
            other => Err(StoreError::Other(format!(
                "type de statistique inconnu : {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Stat {
    pub id: Uuid,
    #[schema(example = "Éliminations")]
    pub name: String,
    /// Slug unique, clé dans le JSON `match_participant.stats`.
    #[schema(example = "kills")]
    pub key: String,
    #[serde(rename = "type")]
    pub kind: StatType,
}

/// Statistique à créer.
#[derive(Debug, Clone)]
pub struct StatInput {
    pub name: String,
    pub key: String,
    pub kind: StatType,
}

/// Modification partielle d'une statistique : seuls les champs renseignés changent.
#[derive(Debug, Default, Clone)]
pub struct StatUpdate {
    pub name: Option<String>,
    pub key: Option<String>,
    pub kind: Option<StatType>,
}
