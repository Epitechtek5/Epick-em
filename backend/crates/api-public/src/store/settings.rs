//! Réglages d'un compte (langue, thème, préférences de notification) et appareils push.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::str::FromStr;
use utoipa::ToSchema;
use uuid::Uuid;

macro_rules! text_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, ToSchema)]
        #[serde(rename_all = "lowercase")]
        pub enum $name { $($variant),+ }

        impl $name {
            pub const ALL: &'static [$name] = &[$($name::$variant),+];

            pub fn as_str(self) -> &'static str {
                match self { $($name::$variant => $text),+ }
            }
        }

        impl FromStr for $name {
            type Err = String;

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                match value {
                    $($text => Ok($name::$variant),)+
                    other => Err(format!(concat!(stringify!($name), " inconnu : {}"), other)),
                }
            }
        }
    };
}

text_enum! {
    /// Langue de l'interface et des notifications.
    Language { Fr => "fr", En => "en", Es => "es" }
}

text_enum! {
    /// Thème de l'interface.
    Theme { System => "system", Light => "light", Dark => "dark" }
}

text_enum! {
    /// Catégorie de notification, réglable indépendamment par canal.
    Category {
        Tournaments => "tournaments",
        Teams => "teams",
        Matches => "matches",
        Predictions => "predictions",
        Pickem => "pickem",
        Rankings => "rankings",
        Account => "account",
    }
}

text_enum! {
    /// Canal de livraison d'une notification.
    Channel { Email => "email", Push => "push" }
}

/// Préférences d'une catégorie : un canal absent des réglages enregistrés est activé.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ChannelPreferences {
    pub email: bool,
    pub push: bool,
}

/// Réglages d'un compte, toujours complets : les valeurs par défaut comblent les manques.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct UserSettings {
    pub language: Language,
    pub theme: Theme,
    pub notifications: BTreeMap<Category, ChannelPreferences>,
}

impl UserSettings {
    /// Réglages d'un compte qui n'a rien configuré : français, thème du système, tout activé.
    pub fn defaults() -> Self {
        Self::from_overrides(Language::Fr, Theme::System, &BTreeMap::new())
    }

    /// Complète les surcharges enregistrées (clés plates `<catégorie>_<canal>`).
    pub fn from_overrides(
        language: Language,
        theme: Theme,
        overrides: &BTreeMap<String, bool>,
    ) -> Self {
        let get = |category: Category, channel: Channel| {
            overrides
                .get(&override_key(category, channel))
                .copied()
                .unwrap_or(true)
        };
        UserSettings {
            language,
            theme,
            notifications: Category::ALL
                .iter()
                .map(|&category| {
                    (
                        category,
                        ChannelPreferences {
                            email: get(category, Channel::Email),
                            push: get(category, Channel::Push),
                        },
                    )
                })
                .collect(),
        }
    }

    /// `true` si la catégorie est activée sur ce canal.
    pub fn allows(&self, category: Category, channel: Channel) -> bool {
        self.notifications
            .get(&category)
            .is_none_or(|prefs| match channel {
                Channel::Email => prefs.email,
                Channel::Push => prefs.push,
            })
    }
}

/// Clé plate d'une préférence dans la colonne JSON `notifications`.
pub fn override_key(category: Category, channel: Channel) -> String {
    format!("{}_{}", category.as_str(), channel.as_str())
}

/// Modification partielle : seuls les champs renseignés changent.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct SettingsUpdate {
    pub language: Option<Language>,
    pub theme: Option<Theme>,
    pub notifications: Vec<(Category, Channel, bool)>,
}

impl SettingsUpdate {
    /// Surcharges au format de la colonne JSON.
    pub fn overrides(&self) -> BTreeMap<String, bool> {
        self.notifications
            .iter()
            .map(|&(category, channel, value)| (override_key(category, channel), value))
            .collect()
    }
}

text_enum! {
    /// Plateforme d'un appareil enregistré pour le push.
    Platform { Ios => "ios", Android => "android" }
}

/// Appareil enregistré pour recevoir des notifications push.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token: String,
    pub platform: Platform,
}

/// Nombre maximal d'appareils par compte ; les plus anciens sont retirés au-delà.
pub const MAX_PUSH_TOKENS: i64 = 10;
