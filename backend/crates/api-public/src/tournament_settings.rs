//! Configuration d'un tournoi (mode, lieu, visibilité, règles, composition des équipes,
//! inscriptions, pointage) : corps des requêtes, validation et réponses aux champs d'inscription.

use crate::store::{
    FieldType, ParticipantType, RegistrationField, RegistrationPolicy, TournamentMode,
    TournamentSettings, Visibility,
};
use crate::team_io::normalize_timestamp;
use crate::tournaments::nullable;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::HashSet;
use utoipa::ToSchema;

pub(crate) type FieldErrors = Vec<(&'static str, String)>;

const LOCATION_MAX: usize = 255;
const RULES_MAX: usize = 20_000;
const TEAM_LIMIT: i32 = 100;
const FIELDS_MAX: usize = 30;
const FIELD_KEY_MAX: usize = 40;
const FIELD_LABEL_MAX: usize = 100;
const OPTIONS_MAX: usize = 50;
const ANSWER_MAX: usize = 500;
const DATE_HELP: &str = "Date RFC 3339 en UTC attendue (ex. 2026-11-14T18:00:00Z).";

/// Configuration à la création ; chaque champ a une valeur par défaut.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub(crate) struct SettingsRequest {
    /// `online` par défaut.
    pub mode: Option<TournamentMode>,
    pub location: Option<String>,
    /// `public` par défaut.
    pub visibility: Option<Visibility>,
    /// Règlement du tournoi, distinct de la description.
    pub rules: Option<String>,
    /// Titulaires par équipe : obligatoires avec `team` (au plus `team_max_starters`).
    pub team_min_starters: Option<i32>,
    pub team_max_starters: Option<i32>,
    /// Remplaçants maximum par équipe ; absent, ils ne sont pas limités.
    pub team_max_substitutes: Option<i32>,
    /// Ancien nombre fixe de joueurs : équivaut à `team_min_starters` = `team_max_starters`.
    #[schema(deprecated)]
    pub team_size: Option<i32>,
    /// `open` par défaut.
    pub registration_policy: Option<RegistrationPolicy>,
    /// `false` par défaut : un tournoi complet refuse alors les inscriptions.
    pub waiting_list_enabled: Option<bool>,
    pub registration_fields: Option<Vec<RegistrationField>>,
    /// Fenêtre de pointage (RFC 3339 en UTC).
    pub check_in_open_at: Option<String>,
    pub check_in_close_at: Option<String>,
}

/// L'ancien `team_size` n'a de sens que pour un tournoi par équipes.
pub(crate) fn legacy_team_size_errors(
    team_size: Option<i32>,
    participant_type: ParticipantType,
) -> FieldErrors {
    if team_size.is_some() && participant_type == ParticipantType::Solo {
        vec![(
            "team_size",
            "`team_size` n'a de sens que pour un tournoi par équipes.".to_string(),
        )]
    } else {
        Vec::new()
    }
}

impl SettingsRequest {
    pub fn into_settings(self, participant_type: ParticipantType) -> TournamentSettings {
        let (mut min, mut max) = (self.team_min_starters, self.team_max_starters);
        if participant_type == ParticipantType::Team {
            min = min.or(self.team_size);
            max = max.or(self.team_size).or(min);
            min = min.or(max);
        }
        TournamentSettings {
            mode: self.mode.unwrap_or(TournamentMode::Online),
            location: self.location,
            visibility: self.visibility.unwrap_or(Visibility::Public),
            rules: self.rules,
            team_min_starters: min,
            team_max_starters: max,
            team_max_substitutes: self.team_max_substitutes,
            registration_policy: self.registration_policy.unwrap_or(RegistrationPolicy::Open),
            waiting_list_enabled: self.waiting_list_enabled.unwrap_or(false),
            registration_fields: self.registration_fields.unwrap_or_default(),
            check_in_open_at: self.check_in_open_at,
            check_in_close_at: self.check_in_close_at,
        }
    }
}

/// Configuration à la modification : champs facultatifs, `null` efface une valeur facultative.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub(crate) struct UpdateSettingsRequest {
    pub mode: Option<TournamentMode>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<String>)]
    pub location: Option<Option<String>>,
    pub visibility: Option<Visibility>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<String>)]
    pub rules: Option<Option<String>>,
    pub team_min_starters: Option<i32>,
    pub team_max_starters: Option<i32>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<i32>)]
    pub team_max_substitutes: Option<Option<i32>>,
    /// Ancien nombre fixe de joueurs : fixe `team_min_starters` et `team_max_starters`.
    #[schema(deprecated)]
    pub team_size: Option<i32>,
    pub registration_policy: Option<RegistrationPolicy>,
    pub waiting_list_enabled: Option<bool>,
    pub registration_fields: Option<Vec<RegistrationField>>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<String>)]
    pub check_in_open_at: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    #[schema(value_type = Option<String>)]
    pub check_in_close_at: Option<Option<String>>,
}

impl UpdateSettingsRequest {
    /// Vrai si la requête touche la composition des équipes ou le pointage (verrouillés dès que
    /// le tournoi est en cours).
    pub fn touches_team_composition(&self) -> bool {
        self.team_min_starters.is_some()
            || self.team_max_starters.is_some()
            || self.team_max_substitutes.is_some()
            || self.team_size.is_some()
    }

    pub fn touches_check_in(&self) -> bool {
        self.check_in_open_at.is_some() || self.check_in_close_at.is_some()
    }

    pub fn is_empty(&self) -> bool {
        self.mode.is_none()
            && self.location.is_none()
            && self.visibility.is_none()
            && self.rules.is_none()
            && !self.touches_team_composition()
            && self.registration_policy.is_none()
            && self.waiting_list_enabled.is_none()
            && self.registration_fields.is_none()
            && !self.touches_check_in()
    }

    /// Applique la requête à la configuration existante.
    pub fn merge(self, mut current: TournamentSettings) -> TournamentSettings {
        if let Some(mode) = self.mode {
            current.mode = mode;
        }
        if let Some(location) = self.location {
            current.location = location;
        }
        if let Some(visibility) = self.visibility {
            current.visibility = visibility;
        }
        if let Some(rules) = self.rules {
            current.rules = rules;
        }
        if let Some(size) = self.team_size {
            current.team_min_starters = Some(size);
            current.team_max_starters = Some(size);
        }
        if let Some(min) = self.team_min_starters {
            current.team_min_starters = Some(min);
        }
        if let Some(max) = self.team_max_starters {
            current.team_max_starters = Some(max);
        }
        if let Some(substitutes) = self.team_max_substitutes {
            current.team_max_substitutes = substitutes;
        }
        if let Some(policy) = self.registration_policy {
            current.registration_policy = policy;
        }
        if let Some(waiting_list) = self.waiting_list_enabled {
            current.waiting_list_enabled = waiting_list;
        }
        if let Some(fields) = self.registration_fields {
            current.registration_fields = fields;
        }
        if let Some(open) = self.check_in_open_at {
            current.check_in_open_at = open;
        }
        if let Some(close) = self.check_in_close_at {
            current.check_in_close_at = close;
        }
        current
    }
}

fn trimmed(value: &mut Option<String>, field: &'static str, max: usize, errors: &mut FieldErrors) {
    *value = value
        .take()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());
    if value
        .as_ref()
        .is_some_and(|text| text.chars().count() > max)
    {
        errors.push((field, format!("Le champ dépasse {max} caractères.")));
    }
}

/// Nettoie et valide la configuration (dates normalisées, textes rognés) ; renvoie les erreurs
/// par champ.
pub(crate) fn check_settings(
    settings: &mut TournamentSettings,
    participant_type: ParticipantType,
) -> FieldErrors {
    let mut errors = Vec::new();
    trimmed(
        &mut settings.location,
        "location",
        LOCATION_MAX,
        &mut errors,
    );
    trimmed(&mut settings.rules, "rules", RULES_MAX, &mut errors);
    match participant_type {
        ParticipantType::Team => {
            match (settings.team_min_starters, settings.team_max_starters) {
                (Some(min), Some(max))
                    if (1..=TEAM_LIMIT).contains(&min) && (min..=TEAM_LIMIT).contains(&max) => {}
                (Some(min), Some(max)) if max < min => errors.push((
                    "team_max_starters",
                    "Le maximum de titulaires ne peut pas être inférieur au minimum.".to_string(),
                )),
                _ => errors.push((
                    "team_min_starters",
                    format!(
                        "`team_min_starters` et `team_max_starters` (1 à {TEAM_LIMIT}) sont \
                         obligatoires pour un tournoi par équipes."
                    ),
                )),
            }
            if settings
                .team_max_substitutes
                .is_some_and(|n| !(0..=TEAM_LIMIT).contains(&n))
            {
                errors.push((
                    "team_max_substitutes",
                    format!("Le nombre de remplaçants doit être compris entre 0 et {TEAM_LIMIT}."),
                ));
            }
        }
        ParticipantType::Solo => {
            if settings.team_min_starters.is_some()
                || settings.team_max_starters.is_some()
                || settings.team_max_substitutes.is_some()
            {
                errors.push((
                    "team_min_starters",
                    "La composition des équipes n'a de sens que pour un tournoi par équipes."
                        .to_string(),
                ));
            }
        }
    }
    errors.extend(check_fields(&mut settings.registration_fields));
    let mut date = |field: &'static str, value: &mut Option<String>| {
        if let Some(text) = value {
            match normalize_timestamp(text) {
                Some(normalized) => *text = normalized,
                None => errors.push((field, DATE_HELP.to_string())),
            }
        }
    };
    date("check_in_open_at", &mut settings.check_in_open_at);
    date("check_in_close_at", &mut settings.check_in_close_at);
    if let (Some(open), Some(close)) = (&settings.check_in_open_at, &settings.check_in_close_at)
        && close < open
        && errors
            .iter()
            .all(|(field, _)| !field.starts_with("check_in"))
    {
        errors.push((
            "check_in_close_at",
            "La clôture du pointage ne peut pas précéder son ouverture.".to_string(),
        ));
    }
    errors
}

fn check_fields(fields: &mut [RegistrationField]) -> FieldErrors {
    let mut errors = Vec::new();
    if fields.len() > FIELDS_MAX {
        errors.push((
            "registration_fields",
            format!("Au plus {FIELDS_MAX} champs d'inscription."),
        ));
        return errors;
    }
    let mut keys = HashSet::new();
    for field in fields.iter_mut() {
        field.label = field.label.trim().to_string();
        let key_ok = !field.key.is_empty()
            && field.key.chars().count() <= FIELD_KEY_MAX
            && field
                .key
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_');
        if !key_ok {
            errors.push((
                "registration_fields",
                format!(
                    "La clé `{}` doit contenir de 1 à {FIELD_KEY_MAX} lettres, chiffres ou `_`.",
                    field.key
                ),
            ));
        } else if !keys.insert(field.key.clone()) {
            errors.push((
                "registration_fields",
                format!("La clé `{}` est utilisée deux fois.", field.key),
            ));
        }
        if field.label.is_empty() || field.label.chars().count() > FIELD_LABEL_MAX {
            errors.push((
                "registration_fields",
                format!(
                    "Le libellé de `{}` doit contenir de 1 à {FIELD_LABEL_MAX} caractères.",
                    field.key
                ),
            ));
        }
        match field.field_type {
            FieldType::Select => {
                let distinct: HashSet<&String> = field.options.iter().collect();
                if field.options.is_empty()
                    || field.options.len() > OPTIONS_MAX
                    || field.options.iter().any(|o| o.trim().is_empty())
                    || distinct.len() != field.options.len()
                {
                    errors.push((
                        "registration_fields",
                        format!(
                            "`{}` : un champ `select` demande de 1 à {OPTIONS_MAX} options \
                             distinctes et non vides.",
                            field.key
                        ),
                    ));
                }
            }
            _ if !field.options.is_empty() => errors.push((
                "registration_fields",
                format!(
                    "`{}` : `options` n'a de sens que pour le type `select`.",
                    field.key
                ),
            )),
            _ => {}
        }
    }
    errors
}

/// Valide les réponses d'un inscrit contre les champs du tournoi et renvoie l'objet à stocker :
/// toutes les clés sont connues, les champs obligatoires renseignés, chaque valeur du bon type.
pub(crate) fn validate_responses(
    fields: &[RegistrationField],
    responses: Option<Value>,
) -> Result<Value, FieldErrors> {
    let given = match responses {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(map)) => map,
        Some(_) => {
            return Err(vec![(
                "responses",
                "`responses` doit être un objet { clé: valeur }.".to_string(),
            )]);
        }
    };
    let mut errors = Vec::new();
    for key in given.keys() {
        if !fields.iter().any(|field| &field.key == key) {
            errors.push(("responses", format!("Champ inconnu : `{key}`.")));
        }
    }
    let mut stored = Map::new();
    for field in fields {
        match given.get(&field.key) {
            None | Some(Value::Null) => {
                if field.required {
                    errors.push((
                        "responses",
                        format!("Le champ `{}` est obligatoire.", field.key),
                    ));
                }
            }
            Some(value) => match check_answer(field, value) {
                Ok(value) => {
                    stored.insert(field.key.clone(), value);
                }
                Err(message) => errors.push(("responses", message)),
            },
        }
    }
    if errors.is_empty() {
        Ok(Value::Object(stored))
    } else {
        Err(errors)
    }
}

fn check_answer(field: &RegistrationField, value: &Value) -> Result<Value, String> {
    let wrong = |expected: &str| format!("`{}` : {expected} attendu.", field.key);
    match field.field_type {
        FieldType::Text => {
            let text = value.as_str().ok_or_else(|| wrong("texte"))?.trim();
            if text.is_empty() && field.required {
                return Err(format!("Le champ `{}` est obligatoire.", field.key));
            }
            if text.chars().count() > ANSWER_MAX {
                return Err(format!("`{}` dépasse {ANSWER_MAX} caractères.", field.key));
            }
            Ok(Value::String(text.to_string()))
        }
        FieldType::Number => match value.as_f64() {
            Some(number) if number.is_finite() && value.is_number() => Ok(value.clone()),
            _ => Err(wrong("nombre")),
        },
        FieldType::Boolean => match value {
            Value::Bool(_) => Ok(value.clone()),
            _ => Err(wrong("booléen")),
        },
        FieldType::Select => {
            let choice = value.as_str().ok_or_else(|| wrong("texte"))?;
            if field.options.iter().any(|option| option == choice) {
                Ok(value.clone())
            } else {
                Err(format!(
                    "`{}` : valeur hors des options ({}).",
                    field.key,
                    field.options.join(", ")
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn field(
        key: &str,
        field_type: FieldType,
        required: bool,
        options: &[&str],
    ) -> RegistrationField {
        RegistrationField {
            key: key.to_string(),
            label: key.to_string(),
            field_type,
            required,
            options: options.iter().map(|o| o.to_string()).collect(),
        }
    }

    #[test]
    fn team_size_alias_fills_the_starter_range() {
        let request = SettingsRequest {
            team_size: Some(5),
            ..Default::default()
        };
        let settings = request.into_settings(ParticipantType::Team);
        assert_eq!(settings.team_min_starters, Some(5));
        assert_eq!(settings.team_max_starters, Some(5));
        let solo = SettingsRequest {
            team_size: Some(5),
            ..Default::default()
        }
        .into_settings(ParticipantType::Solo);
        assert_eq!(solo.team_max_starters, None);
    }

    #[test]
    fn starter_range_and_substitutes_are_checked() {
        let mut ok = TournamentSettings::team(5);
        assert!(check_settings(&mut ok, ParticipantType::Team).is_empty());
        let mut inverted = TournamentSettings::team(5);
        inverted.team_min_starters = Some(6);
        assert!(!check_settings(&mut inverted, ParticipantType::Team).is_empty());
        let mut subs = TournamentSettings::team(5);
        subs.team_max_substitutes = Some(-1);
        assert!(!check_settings(&mut subs, ParticipantType::Team).is_empty());
        let mut solo = TournamentSettings::team(2);
        assert!(!check_settings(&mut solo, ParticipantType::Solo).is_empty());
        let mut missing = TournamentSettings::solo();
        assert!(!check_settings(&mut missing, ParticipantType::Team).is_empty());
    }

    #[test]
    fn check_in_window_must_be_ordered() {
        let mut settings = TournamentSettings::solo();
        settings.check_in_open_at = Some("2026-11-14T18:00:00Z".into());
        settings.check_in_close_at = Some("2026-11-14T17:00:00Z".into());
        assert!(!check_settings(&mut settings, ParticipantType::Solo).is_empty());
        settings.check_in_close_at = Some("2026-11-14T19:00:00Z".into());
        assert!(check_settings(&mut settings, ParticipantType::Solo).is_empty());
    }

    #[test]
    fn registration_fields_are_validated() {
        let mut settings = TournamentSettings::solo();
        settings.registration_fields = vec![
            field("rank", FieldType::Select, true, &["gold"]),
            field("rank", FieldType::Text, false, &[]),
        ];
        assert!(!check_settings(&mut settings, ParticipantType::Solo).is_empty());
        settings.registration_fields = vec![field("bad key", FieldType::Text, false, &[])];
        assert!(!check_settings(&mut settings, ParticipantType::Solo).is_empty());
        settings.registration_fields = vec![field("pick", FieldType::Select, false, &[])];
        assert!(!check_settings(&mut settings, ParticipantType::Solo).is_empty());
        settings.registration_fields = vec![field("name", FieldType::Text, true, &["x"])];
        assert!(!check_settings(&mut settings, ParticipantType::Solo).is_empty());
    }

    #[test]
    fn responses_are_typed_and_complete() {
        let fields = vec![
            field("name", FieldType::Text, true, &[]),
            field("level", FieldType::Number, false, &[]),
            field("platform", FieldType::Select, false, &["pc", "console"]),
            field("streams", FieldType::Boolean, false, &[]),
        ];
        let stored = validate_responses(
            &fields,
            Some(json!({"name": " Faker ", "level": 12, "platform": "pc", "streams": true})),
        )
        .unwrap();
        assert_eq!(stored["name"], "Faker");
        assert!(validate_responses(&fields, None).is_err());
        assert!(validate_responses(&fields, Some(json!({"name": "a", "level": "x"}))).is_err());
        assert!(validate_responses(&fields, Some(json!({"name": "a", "platform": "ps"}))).is_err());
        assert!(validate_responses(&fields, Some(json!({"name": "a", "streams": "yes"}))).is_err());
        assert!(validate_responses(&fields, Some(json!({"name": "a", "other": 1}))).is_err());
        assert!(validate_responses(&fields, Some(json!({"name": ""}))).is_err());
        assert!(validate_responses(&fields, Some(json!([1]))).is_err());
        assert!(
            validate_responses(&[], None)
                .unwrap()
                .as_object()
                .unwrap()
                .is_empty()
        );
    }
}
