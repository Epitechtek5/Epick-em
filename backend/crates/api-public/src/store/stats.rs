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
    /// Choix parmi des options propres à chaque jeu (personnage, champion, carte...).
    Select,
    /// Participant ou joueur désigné meilleur joueur (MVP) ; toujours de portée `match`.
    Mvp,
}

impl StatType {
    pub fn as_str(self) -> &'static str {
        match self {
            StatType::Flat => "flat",
            StatType::Percent => "percent",
            StatType::Select => "select",
            StatType::Mvp => "mvp",
        }
    }

    /// Valeur numérique, seule à pouvoir entrer dans un barème.
    pub fn is_numeric(self) -> bool {
        matches!(self, StatType::Flat | StatType::Percent)
    }
}

impl FromStr for StatType {
    type Err = StoreError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "flat" => Ok(StatType::Flat),
            "percent" => Ok(StatType::Percent),
            "select" => Ok(StatType::Select),
            "mvp" => Ok(StatType::Mvp),
            other => Err(StoreError::Other(format!(
                "type de statistique inconnu : {other}"
            ))),
        }
    }
}

/// À quoi se rapporte la valeur d'une statistique.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum StatScope {
    /// Une valeur par participant (ou par joueur) dans une partie.
    #[default]
    Participant,
    /// Un attribut de la partie elle-même (carte, MVP...).
    Match,
}

impl StatScope {
    pub fn as_str(self) -> &'static str {
        match self {
            StatScope::Participant => "participant",
            StatScope::Match => "match",
        }
    }
}

impl FromStr for StatScope {
    type Err = StoreError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "participant" => Ok(StatScope::Participant),
            "match" => Ok(StatScope::Match),
            other => Err(StoreError::Other(format!(
                "portée de statistique inconnue : {other}"
            ))),
        }
    }
}

/// Valeur autorisée d'une statistique `select` pour un jeu : `key` est l'identifiant stable
/// stocké dans les résultats, `label` le libellé affiché.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct StatOption {
    #[schema(pattern = "^[a-z0-9]+(_[a-z0-9]+)*$", example = "ascent")]
    pub key: String,
    #[schema(example = "Ascent")]
    pub label: String,
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
    /// `participant` (par défaut) ou `match` (attribut de la partie).
    pub scope: StatScope,
    /// Options autorisées pour le jeu, seulement pour une statistique `select` renvoyée par
    /// `/games/{id}/stats` (les options dépendent du jeu).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<StatOption>,
}

/// Statistique à créer.
#[derive(Debug, Clone)]
pub struct StatInput {
    pub name: String,
    pub key: String,
    pub kind: StatType,
    pub scope: StatScope,
}

/// Modification partielle d'une statistique : seuls les champs renseignés changent.
#[derive(Debug, Default, Clone)]
pub struct StatUpdate {
    pub name: Option<String>,
    pub key: Option<String>,
    pub kind: Option<StatType>,
    pub scope: Option<StatScope>,
}
