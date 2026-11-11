//! Traduction des réponses start.gg vers le modèle canonique. Tout champ absent reste absent :
//! rien n'est deviné.

use super::url::public_url;
use crate::model::{
    BracketFormat, CompetitionState, ExternalEntrant, ExternalEventRef, ExternalGame,
    ExternalGroup, ExternalMatch, ExternalPhase, ExternalPlayer, ExternalSelection, ExternalSlot,
    ExternalStanding, ExternalTournamentRef, MatchState,
};
use serde_json::Value;

pub const PROVIDER: &str = "startgg";

/// Identifiant start.gg : nombre, ou chaîne (sets « preview_… » des brackets non lancés).
pub fn id(value: &Value) -> Option<String> {
    match value {
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

fn text(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn int(value: &Value) -> Option<i64> {
    value.as_i64()
}

fn small(value: &Value) -> Option<u32> {
    value.as_u64().and_then(|n| u32::try_from(n).ok())
}

/// État d'un tournoi (entier start.gg : 1 créé, 2 en cours, 3 terminé).
pub fn tournament_state(value: &Value) -> CompetitionState {
    match value.as_i64() {
        Some(2) => CompetitionState::Active,
        Some(3) => CompetitionState::Completed,
        _ => CompetitionState::Created,
    }
}

/// État d'une épreuve ou d'une phase (`ActivityState`).
pub fn activity_state(value: &Value) -> CompetitionState {
    match value.as_str() {
        Some("COMPLETED") => CompetitionState::Completed,
        Some("ACTIVE" | "CALLED" | "QUEUED" | "IN_PROGRESS") => CompetitionState::Active,
        _ => match value.as_i64() {
            Some(n) => tournament_state(&Value::from(n)),
            None => CompetitionState::Created,
        },
    }
}

/// État d'un set (entier : 1 créé, 2 en cours, 3 terminé, 6 appelé, 7 en file…).
pub fn set_state(value: &Value) -> MatchState {
    match value.as_i64() {
        Some(3) => MatchState::Completed,
        Some(2 | 6) => MatchState::InProgress,
        _ => MatchState::Pending,
    }
}

pub fn bracket_format(value: &Value) -> Option<BracketFormat> {
    Some(match value.as_str()? {
        "SINGLE_ELIMINATION" => BracketFormat::SingleElimination,
        "DOUBLE_ELIMINATION" => BracketFormat::DoubleElimination,
        "ROUND_ROBIN" => BracketFormat::RoundRobin,
        "SWISS" => BracketFormat::Swiss,
        _ => BracketFormat::Other,
    })
}

pub fn tournament_ref(node: &Value) -> Option<ExternalTournamentRef> {
    Some(ExternalTournamentRef {
        provider: PROVIDER.into(),
        external_id: id(&node["id"])?,
        slug: text(&node["slug"]).map(|s| s.trim_start_matches("tournament/").to_string()),
        name: text(&node["name"])?,
        url: text(&node["url"]).or_else(|| text(&node["slug"]).map(|s| public_url(&s))),
        starts_at: int(&node["startAt"]),
        ends_at: int(&node["endAt"]),
    })
}

pub fn event_ref(node: &Value) -> Option<ExternalEventRef> {
    Some(ExternalEventRef {
        external_id: id(&node["id"])?,
        name: text(&node["name"])?,
        game: text(&node["videogame"]["name"]),
        url: text(&node["slug"]).map(|s| public_url(&s)),
        starts_at: int(&node["startAt"]),
        state: activity_state(&node["state"]),
        entrant_count: small(&node["numEntrants"]),
    })
}

pub fn phase(node: &Value) -> Option<ExternalPhase> {
    let format = bracket_format(&node["bracketType"]);
    Some(ExternalPhase {
        external_id: id(&node["id"])?,
        name: text(&node["name"]).unwrap_or_default(),
        order: small(&node["phaseOrder"]),
        format,
        state: activity_state(&node["state"]),
        groups: node["phaseGroups"]["nodes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|group| {
                Some(ExternalGroup {
                    external_id: id(&group["id"])?,
                    label: text(&group["displayIdentifier"]),
                    format: bracket_format(&group["bracketType"]).or(format),
                    state: activity_state(&group["state"]),
                    url: text(&group["bracketUrl"]),
                })
            })
            .collect(),
    })
}

pub fn entrant(node: &Value) -> Option<ExternalEntrant> {
    Some(ExternalEntrant {
        external_id: id(&node["id"])?,
        name: text(&node["name"])?,
        seed: small(&node["initialSeedNum"]),
        players: node["participants"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|p| {
                Some(ExternalPlayer {
                    external_id: id(&p["id"])?,
                    gamer_tag: text(&p["gamerTag"])?,
                    prefix: text(&p["prefix"]),
                })
            })
            .collect(),
    })
}

/// `event_url` : URL de l'épreuve, pour un lien vers le set.
pub fn set(node: &Value, event_url: Option<&str>) -> Option<ExternalMatch> {
    let external_id = id(&node["id"])?;
    let disqualified = node["displayScore"].as_str() == Some("DQ");
    let mut forfeit = disqualified;
    let slots = node["slots"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|slot| {
            let raw = int(&slot["standing"]["stats"]["score"]["value"]);
            // start.gg note -1 le score d'un joueur disqualifié.
            if raw == Some(-1) {
                forfeit = true;
            }
            ExternalSlot {
                entrant_id: id(&slot["entrant"]["id"]),
                score: raw.filter(|&s| s >= 0).and_then(|s| i32::try_from(s).ok()),
            }
        })
        .collect();
    let games = node["games"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(index, game)| ExternalGame {
            external_id: id(&game["id"]),
            order: small(&game["orderNum"]).unwrap_or(index as u32 + 1),
            winner_entrant_id: id(&game["winnerId"]),
            stage: text(&game["stage"]["name"]),
            selections: game["selections"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|s| {
                    Some(ExternalSelection {
                        entrant_id: id(&s["entrant"]["id"])?,
                        character: text(&s["character"]["name"]),
                    })
                })
                .collect(),
        })
        .collect();
    let round = int(&node["round"]).and_then(|r| i32::try_from(r).ok());
    let url = event_url
        .filter(|_| !external_id.starts_with("preview"))
        .map(|u| format!("{u}/set/{external_id}"));
    Some(ExternalMatch {
        phase_id: id(&node["phaseGroup"]["phase"]["id"]),
        group_id: id(&node["phaseGroup"]["id"]),
        round,
        round_label: text(&node["fullRoundText"]),
        state: set_state(&node["state"]),
        winner_entrant_id: id(&node["winnerId"]),
        forfeit,
        slots,
        games,
        started_at: int(&node["startedAt"]),
        completed_at: int(&node["completedAt"]),
        updated_at: None,
        url,
        external_id,
    })
}

pub fn standing(node: &Value) -> Option<ExternalStanding> {
    Some(ExternalStanding {
        entrant_id: id(&node["entrant"]["id"])?,
        placement: small(&node["placement"])?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sets_keep_only_what_start_gg_provides() {
        let node = json!({
            "id": 42, "round": -2, "fullRoundText": "Losers Round 2", "state": 3,
            "winnerId": 7, "displayScore": "DQ",
            "phaseGroup": { "id": 9, "phase": { "id": 8 } },
            "slots": [
                { "entrant": { "id": 7 }, "standing": { "stats": { "score": { "value": 0 } } } },
                { "entrant": { "id": 6 }, "standing": { "stats": { "score": { "value": -1 } } } }
            ],
            "games": null
        });
        let m = set(&node, Some("https://www.start.gg/tournament/t/event/e")).unwrap();
        assert_eq!(m.external_id, "42");
        assert_eq!(m.round, Some(-2));
        assert_eq!(m.state, MatchState::Completed);
        assert!(m.forfeit);
        assert_eq!(m.slots[1].score, None, "un DQ n'a pas de score inventé");
        assert!(m.games.is_empty());
        assert_eq!(m.group_id.as_deref(), Some("9"));
        assert_eq!(
            m.url.as_deref(),
            Some("https://www.start.gg/tournament/t/event/e/set/42")
        );

        let preview = set(&json!({"id": "preview_1_2", "slots": [{}]}), Some("u")).unwrap();
        assert_eq!(preview.url, None);
        assert_eq!(preview.slots[0].entrant_id, None);
        assert_eq!(preview.state, MatchState::Pending);
        assert!(
            set(&json!({"round": 1}), None).is_none(),
            "pas d'identifiant"
        );
    }

    #[test]
    fn states_and_formats() {
        assert_eq!(tournament_state(&json!(2)), CompetitionState::Active);
        assert_eq!(
            activity_state(&json!("COMPLETED")),
            CompetitionState::Completed
        );
        assert_eq!(set_state(&json!(6)), MatchState::InProgress);
        assert_eq!(
            bracket_format(&json!("CUSTOM_SCHEDULE")),
            Some(BracketFormat::Other)
        );
        assert_eq!(bracket_format(&Value::Null), None);
    }
}
