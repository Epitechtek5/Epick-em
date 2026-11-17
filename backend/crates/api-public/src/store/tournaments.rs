//! Types des tournois (tables `tournaments`, `tournament_participant` et `scoring_rule`).

use serde::{Deserialize, Serialize};
use std::str::FromStr;
use utoipa::ToSchema;
use uuid::Uuid;

use super::StoreError;

/// Définit une énumération stockée en texte dans PostgreSQL, avec `as_str` et `FromStr`.
macro_rules! text_enum {
    ($(#[$meta:meta])* $name:ident, $label:literal, { $($variant:ident => $text:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
        #[serde(rename_all = "snake_case")]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            pub fn as_str(self) -> &'static str {
                match self {
                    $($name::$variant => $text),+
                }
            }
        }

        impl FromStr for $name {
            type Err = StoreError;

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                match value {
                    $($text => Ok($name::$variant),)+
                    other => Err(StoreError::Other(format!("{} inconnu : {other}", $label))),
                }
            }
        }
    };
}

pub(super) use text_enum;

text_enum! {
    /// Qui s'inscrit : des joueurs un par un, ou des équipes.
    ParticipantType, "type de participant", { Solo => "solo", Team => "team" }
}

text_enum! {
    /// Agrégation des scores des joueurs d'une équipe pour le classement des équipes.
    TeamScoringMode, "mode de score d'équipe", {
        None => "none",
        Sum => "sum",
        Best => "best",
        TopN => "top_n",
    }
}

text_enum! {
    /// Cycle de vie d'un tournoi ; le barème et les étapes sont verrouillés dès `Ongoing`.
    TournamentStatus, "statut de tournoi", {
        Draft => "draft",
        Registration => "registration",
        Ongoing => "ongoing",
        Finished => "finished",
        Cancelled => "cancelled",
    }
}

text_enum! {
    /// Situation d'un inscrit dans le tournoi. `Pending`, `Rejected` et `Waitlisted` précèdent
    /// l'inscription effective ; `Absent` suit une clôture du pointage sans pointage.
    ParticipantStatus, "statut de participant", {
        Pending => "pending",
        Rejected => "rejected",
        Waitlisted => "waitlisted",
        Registered => "registered",
        CheckedIn => "checked_in",
        Absent => "absent",
        Disqualified => "disqualified",
        Withdrawn => "withdrawn",
    }
}

impl ParticipantStatus {
    /// Les inscrits qui occupent une place du tournoi (plafond `max_participants`).
    pub fn holds_a_seat(self) -> bool {
        matches!(
            self,
            ParticipantStatus::Registered
                | ParticipantStatus::CheckedIn
                | ParticipantStatus::Disqualified
        )
    }
}

text_enum! {
    /// Lieu du tournoi.
    TournamentMode, "mode de tournoi", {
        Online => "online",
        InPerson => "in_person",
        Hybrid => "hybrid",
    }
}

text_enum! {
    /// Qui peut voir le tournoi : tout le monde, ou seulement les invités et les inscrits.
    Visibility, "visibilité", { Public => "public", InvitationOnly => "invitation_only" }
}

text_enum! {
    /// Une inscription est acceptée d'office, ou attend l'approbation d'un administrateur.
    RegistrationPolicy, "politique d'inscription", {
        Open => "open",
        ApprovalRequired => "approval_required",
    }
}

text_enum! {
    /// Rôle délégué sur un seul tournoi (le propriétaire est `Tournament::owner_id`).
    TournamentRole, "rôle de tournoi", { Admin => "admin", Referee => "referee" }
}

text_enum! {
    /// Opération consignée dans le journal des rôles d'un tournoi.
    RoleAuditAction, "action d'audit", {
        Assign => "assign",
        Revoke => "revoke",
        Transfer => "transfer",
    }
}

text_enum! {
    /// Type d'un champ d'inscription personnalisé.
    FieldType, "type de champ", {
        Text => "text",
        Number => "number",
        Select => "select",
        Boolean => "boolean",
    }
}

/// Champ d'inscription défini par l'organisateur (pseudo en jeu, rang, plateforme…).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RegistrationField {
    /// Clé de la réponse : lettres, chiffres et `_`, unique dans le tournoi.
    #[schema(example = "ingame_name")]
    pub key: String,
    #[schema(example = "Pseudo en jeu")]
    pub label: String,
    pub field_type: FieldType,
    #[serde(default)]
    pub required: bool,
    /// Valeurs permises, obligatoires et seulement admises pour le type `select`.
    #[serde(default)]
    pub options: Vec<String>,
}

/// Configuration d'un tournoi : tout ce qu'un doublon ou un modèle recopie, sans état de
/// fonctionnement (inscrits, résultats, statut).
///
/// En sortie, `team_size` (ancien nombre fixe de titulaires, égal à `team_max_starters`)
/// accompagne la fourchette tant que les clients mobiles le lisent encore.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(into = "SettingsOutput")]
pub struct TournamentSettings {
    pub mode: TournamentMode,
    /// Lieu, pour les tournois `in_person` et `hybrid`.
    pub location: Option<String>,
    pub visibility: Visibility,
    /// Règlement, distinct de la description.
    pub rules: Option<String>,
    /// Titulaires par équipe, renseignés si et seulement si le tournoi est par équipes.
    pub team_min_starters: Option<i32>,
    pub team_max_starters: Option<i32>,
    /// Remplaçants maximum par équipe ; `null` ne limite pas.
    pub team_max_substitutes: Option<i32>,
    pub registration_policy: RegistrationPolicy,
    /// Les inscrits au-delà de la capacité attendent sur liste d'attente au lieu d'être refusés.
    pub waiting_list_enabled: bool,
    pub registration_fields: Vec<RegistrationField>,
    /// Fenêtre de pointage, horodatages RFC 3339 en UTC.
    pub check_in_open_at: Option<String>,
    pub check_in_close_at: Option<String>,
}

impl TournamentSettings {
    /// Réglages d'un tournoi solo en ligne, ouvert à tous.
    pub fn solo() -> Self {
        TournamentSettings {
            mode: TournamentMode::Online,
            location: None,
            visibility: Visibility::Public,
            rules: None,
            team_min_starters: None,
            team_max_starters: None,
            team_max_substitutes: None,
            registration_policy: RegistrationPolicy::Open,
            waiting_list_enabled: false,
            registration_fields: Vec::new(),
            check_in_open_at: None,
            check_in_close_at: None,
        }
    }

    /// Réglages d'un tournoi par équipes de `starters` titulaires, remplaçants illimités.
    pub fn team(starters: i32) -> Self {
        TournamentSettings {
            team_min_starters: Some(starters),
            team_max_starters: Some(starters),
            ..Self::solo()
        }
    }
}

/// Forme sérialisée de [`TournamentSettings`] : les réglages plus l'ancien `team_size`.
#[derive(Serialize)]
struct SettingsOutput {
    mode: TournamentMode,
    location: Option<String>,
    visibility: Visibility,
    rules: Option<String>,
    team_min_starters: Option<i32>,
    team_max_starters: Option<i32>,
    team_max_substitutes: Option<i32>,
    /// Obsolète : `team_max_starters`, pour les clients qui ne connaissent pas la fourchette.
    team_size: Option<i32>,
    registration_policy: RegistrationPolicy,
    waiting_list_enabled: bool,
    registration_fields: Vec<RegistrationField>,
    check_in_open_at: Option<String>,
    check_in_close_at: Option<String>,
}

impl From<TournamentSettings> for SettingsOutput {
    fn from(settings: TournamentSettings) -> Self {
        SettingsOutput {
            team_size: settings.team_max_starters,
            mode: settings.mode,
            location: settings.location,
            visibility: settings.visibility,
            rules: settings.rules,
            team_min_starters: settings.team_min_starters,
            team_max_starters: settings.team_max_starters,
            team_max_substitutes: settings.team_max_substitutes,
            registration_policy: settings.registration_policy,
            waiting_list_enabled: settings.waiting_list_enabled,
            registration_fields: settings.registration_fields,
            check_in_open_at: settings.check_in_open_at,
            check_in_close_at: settings.check_in_close_at,
        }
    }
}

/// Modification partielle de la configuration : seuls les champs renseignés sont écrits, pour
/// qu'une modification concurrente d'un autre champ (la visibilité, par exemple) ne soit pas
/// écrasée par une valeur relue avant elle. `Some(None)` efface une valeur facultative.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct SettingsUpdate {
    pub mode: Option<TournamentMode>,
    pub location: Option<Option<String>>,
    pub visibility: Option<Visibility>,
    pub rules: Option<Option<String>>,
    pub team_min_starters: Option<i32>,
    pub team_max_starters: Option<i32>,
    pub team_max_substitutes: Option<Option<i32>>,
    pub registration_policy: Option<RegistrationPolicy>,
    pub waiting_list_enabled: Option<bool>,
    pub registration_fields: Option<Vec<RegistrationField>>,
    pub check_in_open_at: Option<Option<String>>,
    pub check_in_close_at: Option<Option<String>>,
}

impl SettingsUpdate {
    /// Applique les champs renseignés à `settings`.
    pub fn apply(self, settings: &mut TournamentSettings) {
        if let Some(mode) = self.mode {
            settings.mode = mode;
        }
        if let Some(location) = self.location {
            settings.location = location;
        }
        if let Some(visibility) = self.visibility {
            settings.visibility = visibility;
        }
        if let Some(rules) = self.rules {
            settings.rules = rules;
        }
        if let Some(min) = self.team_min_starters {
            settings.team_min_starters = Some(min);
        }
        if let Some(max) = self.team_max_starters {
            settings.team_max_starters = Some(max);
        }
        if let Some(substitutes) = self.team_max_substitutes {
            settings.team_max_substitutes = substitutes;
        }
        if let Some(policy) = self.registration_policy {
            settings.registration_policy = policy;
        }
        if let Some(waiting_list) = self.waiting_list_enabled {
            settings.waiting_list_enabled = waiting_list;
        }
        if let Some(fields) = self.registration_fields {
            settings.registration_fields = fields;
        }
        if let Some(open) = self.check_in_open_at {
            settings.check_in_open_at = open;
        }
        if let Some(close) = self.check_in_close_at {
            settings.check_in_close_at = close;
        }
    }
}

text_enum! {
    /// Conversion de la valeur d'une statistique en points.
    ScoringMode, "mode de barème", { Linear => "linear", Table => "table" }
}

/// Tournoi d'un jeu.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Tournament {
    pub id: Uuid,
    pub game_id: Uuid,
    #[schema(example = "TFT Open")]
    pub name: String,
    pub description: Option<String>,
    /// Horodatages RFC 3339 en UTC.
    pub start_date: String,
    pub end_date: String,
    pub registration_open_at: Option<String>,
    pub registration_close_at: Option<String>,
    pub participant_type: ParticipantType,
    /// Égal à `group_count × group_size` de l'étape 1.
    pub max_participants: i32,
    pub team_scoring_mode: TeamScoringMode,
    /// Nombre de meilleurs scores retenus, renseigné si et seulement si le mode vaut `top_n`.
    pub team_scoring_n: Option<i32>,
    #[serde(flatten)]
    pub settings: TournamentSettings,
    pub status: TournamentStatus,
    /// Créateur du tournoi (ou propriétaire actuel après un transfert).
    pub owner_id: Option<Uuid>,
    /// Modèle réutilisable : jamais listé avec les tournois, jamais ouvert aux inscriptions.
    pub is_template: bool,
    /// Instant où la clôture du pointage a été traitée (absents marqués, liste d'attente promue).
    pub check_in_settled_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Tournoi à créer ; il démarre toujours au statut `draft`.
#[derive(Debug, Clone)]
pub struct TournamentInput {
    pub game_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub start_date: String,
    pub end_date: String,
    pub registration_open_at: Option<String>,
    pub registration_close_at: Option<String>,
    pub participant_type: ParticipantType,
    pub max_participants: i32,
    pub team_scoring_mode: TeamScoringMode,
    pub team_scoring_n: Option<i32>,
    pub settings: TournamentSettings,
    pub owner_id: Option<Uuid>,
    pub is_template: bool,
}

/// Inscrit à un tournoi : un joueur (`user_id`), une équipe de tournoi (`tournament_team_id`), ou
/// un joueur qui marque pour son équipe (les deux).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TournamentParticipant {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub user_id: Option<Uuid>,
    pub tournament_team_id: Option<Uuid>,
    pub status: ParticipantStatus,
    /// Horodatage RFC 3339 en UTC.
    pub registered_at: String,
    /// Réponses aux champs d'inscription personnalisés (`registration_fields`), par clé.
    #[schema(value_type = Object, example = json!({"ingame_name": "Faker"}))]
    pub responses: serde_json::Value,
    /// Inscrit importé d'une source externe, sans compte local : son identifiant chez la source.
    pub external_id: Option<String>,
    /// Nom affiché d'un inscrit importé (son nom chez la source).
    pub display_name: Option<String>,
}

/// Barème d'une statistique : `linear` donne `valeur × coefficient`, `table` associe une valeur
/// à des points (ex. `{"1": 8, "2": 7}`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ScoringRule {
    pub id: Uuid,
    pub tournament_id: Uuid,
    pub stat_id: Uuid,
    pub mode: ScoringMode,
    /// Renseigné si et seulement si `mode` vaut `linear`.
    pub coefficient: Option<f64>,
    /// Renseigné si et seulement si `mode` vaut `table`.
    #[schema(value_type = Option<Object>, example = json!({"1": 8, "2": 7}))]
    pub points_table: Option<serde_json::Value>,
}

/// Modification partielle d'un tournoi : seuls les champs renseignés changent ; `Some(None)`
/// efface une valeur facultative. Les dates sont normalisées (RFC 3339, UTC, six décimales).
#[derive(Debug, Default, Clone)]
pub struct TournamentUpdate {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub registration_open_at: Option<Option<String>>,
    pub registration_close_at: Option<Option<String>>,
    pub max_participants: Option<i32>,
    pub team_scoring_mode: Option<TeamScoringMode>,
    pub team_scoring_n: Option<Option<i32>>,
    /// Champs de configuration à écrire ; les autres restent tels qu'en base.
    pub settings: SettingsUpdate,
}

/// Règle de barème à créer ; `coefficient` est renseigné pour `linear`, `points_table` pour
/// `table`.
#[derive(Debug, Clone)]
pub struct ScoringRuleInput {
    pub tournament_id: Uuid,
    pub stat_id: Uuid,
    pub definition: ScoringRuleDefinition,
}

/// Façon de convertir une statistique en points.
#[derive(Debug, Clone)]
pub struct ScoringRuleDefinition {
    pub mode: ScoringMode,
    pub coefficient: Option<f64>,
    pub points_table: Option<serde_json::Value>,
}

/// Inscription à créer : un joueur, une équipe de tournoi, ou un joueur pour son équipe.
#[derive(Debug, Clone)]
pub struct ParticipantInput {
    pub tournament_id: Uuid,
    pub user_id: Option<Uuid>,
    pub tournament_team_id: Option<Uuid>,
    /// Réponses validées aux champs d'inscription (objet JSON).
    pub responses: serde_json::Value,
}

/// Tournoi à créer ou à mettre à jour (par jeu et nom, sans tenir compte de la casse) depuis un
/// fichier d'import, avec son statut et son barème.
#[derive(Debug, Clone)]
pub struct TournamentImport {
    pub input: TournamentInput,
    pub status: TournamentStatus,
    pub rules: Vec<ScoringRuleImport>,
}

#[derive(Debug, Clone)]
pub struct ScoringRuleImport {
    pub stat_id: Uuid,
    pub definition: ScoringRuleDefinition,
}

/// Inscription importée ; `registered_at` (RFC 3339 UTC, six décimales) vaut l'instant présent
/// s'il est absent.
#[derive(Debug, Clone)]
pub struct ParticipantImport {
    pub user_id: Option<Uuid>,
    pub tournament_team_id: Option<Uuid>,
    pub status: ParticipantStatus,
    pub registered_at: Option<String>,
    pub responses: serde_json::Value,
}

/// Rôle délégué à un compte sur un tournoi.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RoleAssignment {
    pub user_id: Uuid,
    pub role: TournamentRole,
    pub granted_by: Option<Uuid>,
    pub granted_at: String,
}

/// Invitation à un tournoi `invitation_only`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TournamentInvitation {
    pub user_id: Uuid,
    pub invited_by: Option<Uuid>,
    pub invited_at: String,
}

/// Entrée du journal d'audit des rôles : qui a fait quoi, à qui, quand.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RoleAuditEntry {
    pub id: Uuid,
    pub actor_id: Option<Uuid>,
    pub action: RoleAuditAction,
    pub target_user_id: Option<Uuid>,
    pub role: Option<TournamentRole>,
    pub created_at: String,
}

/// Effet de la clôture du pointage : absents marqués, inscrits promus de la liste d'attente.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CheckInSettlement {
    pub absent: Vec<TournamentParticipant>,
    pub promoted: Vec<TournamentParticipant>,
}

/// Changement de statut d'un inscrit, avec les inscrits promus de la liste d'attente dans la
/// même transaction quand une place s'est libérée.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParticipantChange {
    pub participant: TournamentParticipant,
    pub promoted: Vec<TournamentParticipant>,
}

/// Inscrit en lice avec les noms à afficher publiquement (compte et équipe de tournoi).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamedParticipant {
    pub participant: TournamentParticipant,
    pub username: Option<String>,
    pub team_name: Option<String>,
}

/// Réponses d'inscription vides (objet JSON).
pub fn no_responses() -> serde_json::Value {
    serde_json::Value::Object(serde_json::Map::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enums_round_trip_through_their_database_text() {
        for status in ["draft", "registration", "ongoing", "finished", "cancelled"] {
            assert_eq!(status.parse::<TournamentStatus>().unwrap().as_str(), status);
        }
        for mode in ["none", "sum", "best", "top_n"] {
            assert_eq!(mode.parse::<TeamScoringMode>().unwrap().as_str(), mode);
        }
        for status in ["registered", "checked_in", "disqualified", "withdrawn"] {
            assert_eq!(
                status.parse::<ParticipantStatus>().unwrap().as_str(),
                status
            );
        }
        assert!("duo".parse::<ParticipantType>().is_err());
    }

    #[test]
    fn enums_serialize_like_the_database() {
        assert_eq!(
            serde_json::to_string(&TeamScoringMode::TopN).unwrap(),
            "\"top_n\""
        );
        assert_eq!(
            serde_json::to_string(&ParticipantStatus::CheckedIn).unwrap(),
            "\"checked_in\""
        );
    }
}
