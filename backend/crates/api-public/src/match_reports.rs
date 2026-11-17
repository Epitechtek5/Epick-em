//! Validate participant reports with the existing statistics and series engines.

use crate::auth::AppState;
use crate::error::ApiError;
use crate::match_games::{aggregate, is_decided};
use crate::matches::{StatSchema, match_participants, points_of, scoring_of, settle};
use crate::store::{
    Match, MatchGame, MatchGameParticipant, MatchParticipant, MatchResult, MatchScore, MatchStatus,
    ReportedGame, Step, Tournament,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ReportScore {
    pub participant_id: Uuid,
    pub stats: Value,
    pub rank: Option<i32>,
    pub result: Option<MatchResult>,
    pub games_won: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ReportGame {
    pub attributes: Value,
    pub results: Vec<ReportScore>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct Report {
    #[serde(default)]
    pub results: Vec<ReportScore>,
    #[serde(default)]
    pub games: Vec<ReportGame>,
}

pub(crate) fn invalid(field: &'static str, message: &str) -> ApiError {
    ApiError::Validation(vec![(field, message.to_string())])
}

/// Returns normalized scores and games; supplied points are never trusted.
pub(crate) async fn validate_report(
    state: &AppState,
    tournament: &Tournament,
    step: &Step,
    current: &Match,
    report: &Report,
) -> Result<(Vec<MatchScore>, Vec<ReportedGame>), ApiError> {
    let members = match_participants(state, step, current.id).await?;
    if members.len() < 2 || (step.match_type == crate::store::MatchType::Duel && members.len() != 2)
    {
        return Err(invalid(
            "results",
            "The match does not have all required participants.",
        ));
    }
    let (stats, rules) = scoring_of(state, tournament).await?;
    let schema = StatSchema::new(&stats);
    let mut rosters = HashMap::new();
    for member in &members {
        let participant = state
            .store
            .find_participant(member.participant_id)
            .await
            .map_err(ApiError::internal)?
            .ok_or(ApiError::NotFound)?;
        let roster: HashSet<Uuid> = if let Some(team_id) = participant.tournament_team_id {
            state
                .store
                .list_tournament_team_members(team_id)
                .await
                .map_err(ApiError::internal)?
                .unwrap_or_default()
                .into_iter()
                .map(|m| m.user_id)
                .collect()
        } else {
            HashSet::new()
        };
        rosters.insert(member.participant_id, roster);
    }
    let scores = |entries: &[ReportScore], per_game: bool| -> Result<Vec<MatchScore>, ApiError> {
        let expected: HashSet<Uuid> = members.iter().map(|m| m.participant_id).collect();
        let found: HashSet<Uuid> = entries.iter().map(|entry| entry.participant_id).collect();
        if found != expected || entries.len() != expected.len() {
            return Err(invalid(
                "results",
                "Every match participant must appear exactly once.",
            ));
        }
        let mut parsed = Vec::new();
        for entry in entries {
            if entry
                .rank
                .is_some_and(|rank| rank < 1 || rank as usize > entries.len())
            {
                return Err(invalid("results", "Invalid participant placement."));
            }
            if entry
                .games_won
                .is_some_and(|wins| wins < 0 || wins > current.best_of / 2 + 1 || per_game)
            {
                return Err(invalid("results", "Invalid series score."));
            }
            if let Some(players) = entry.stats.get("players").and_then(Value::as_object) {
                for key in players.keys() {
                    let id = Uuid::parse_str(key)
                        .map_err(|_| invalid("results", "Invalid player identifier."))?;
                    if !rosters
                        .get(&entry.participant_id)
                        .is_some_and(|roster| roster.contains(&id))
                    {
                        return Err(invalid(
                            "results",
                            "Player statistics must belong to that participant's roster.",
                        ));
                    }
                }
            }
            let totals = schema
                .parse(&entry.stats)
                .map_err(|message| invalid("results", &message))?;
            parsed.push(MatchScore {
                participant_id: entry.participant_id,
                stats: entry.stats.clone(),
                points: points_of(&totals, &rules, &stats),
                rank: entry.rank,
                result: entry.result,
                games_won: entry.games_won,
                slot: members
                    .iter()
                    .find(|m| m.participant_id == entry.participant_id)
                    .and_then(|m| m.slot),
            });
        }
        parsed.sort_by_key(|score| score.participant_id);
        Ok(parsed)
    };
    if report.games.is_empty() {
        return Ok((scores(&report.results, false)?, Vec::new()));
    }
    if !report.results.is_empty() || report.games.len() > current.best_of as usize {
        return Err(invalid(
            "results",
            "Submit either complete games or aggregate results, not both.",
        ));
    }
    let mut games = Vec::new();
    let mut normalized = Vec::new();
    let designated: HashSet<Uuid> = members
        .iter()
        .map(|p| p.participant_id)
        .chain(rosters.values().flat_map(|roster| roster.iter().copied()))
        .collect();
    for (index, report_game) in report.games.iter().enumerate() {
        if is_decided(current.best_of, &games) {
            return Err(invalid(
                "games",
                "The series was already decided before this game.",
            ));
        }
        schema
            .check_attributes(&report_game.attributes, &designated)
            .map_err(|message| invalid("attributes", &message))?;
        let parsed = scores(&report_game.results, true)?;
        let participants = score_members(current.id, &parsed);
        let settled = settle(&participants).map_err(|message| invalid("results", &message))?;
        games.push(MatchGame {
            id: Uuid::nil(),
            match_id: current.id,
            number: (index + 1) as i32,
            status: MatchStatus::Finished,
            attributes: report_game.attributes.clone(),
            started_at: None,
            ended_at: None,
            created_at: String::new(),
            updated_at: String::new(),
            participants: settled
                .iter()
                .map(|s| MatchGameParticipant {
                    participant_id: s.participant_id,
                    stats: s.stats.clone(),
                    points: s.points,
                    rank: s.rank,
                    result: s.result,
                })
                .collect(),
        });
        normalized.push(ReportedGame {
            attributes: report_game.attributes.clone(),
            results: settled,
        });
    }
    if !is_decided(current.best_of, &games) {
        return Err(invalid(
            "games",
            "The submitted games do not decide the series.",
        ));
    }
    let kinds = stats
        .iter()
        .map(|stat| (stat.key.clone(), stat.kind))
        .collect();
    let ids: Vec<Uuid> = members.iter().map(|p| p.participant_id).collect();
    let aggregated = aggregate(&games, &ids, &kinds);
    let results = aggregated
        .into_iter()
        .map(|p| MatchScore {
            participant_id: p.participant_id,
            stats: p.stats,
            points: p.points,
            rank: p.rank,
            result: p.result,
            games_won: p.games_won,
            slot: members
                .iter()
                .find(|m| m.participant_id == p.participant_id)
                .and_then(|m| m.slot),
        })
        .collect();
    Ok((results, normalized))
}

pub(crate) fn score_members(match_id: Uuid, scores: &[MatchScore]) -> Vec<MatchParticipant> {
    scores
        .iter()
        .map(|s| MatchParticipant {
            match_id,
            participant_id: s.participant_id,
            stats: s.stats.clone(),
            points: s.points,
            rank: s.rank,
            result: s.result,
            slot: s.slot,
            games_won: s.games_won,
        })
        .collect()
}
