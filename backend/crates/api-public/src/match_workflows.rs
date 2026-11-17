//! Participant reporting, independent confirmations and organizer decisions.

use crate::auth::{AppState, Claims};
use crate::error::ApiError;
use crate::match_reports::{Report, invalid, score_members, validate_report};
use crate::matches::{
    close_if_complete, find_match, match_error, match_participants, prepare_series_finish,
};
use crate::steps::find_step;
use crate::store::*;
use crate::tournament_access::access_of;
use crate::tournaments::visible_tournament;
use actix_web::{HttpResponse, get, post, web};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use utoipa::ToSchema;
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(get_workflow).service(update_workflow);
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum MatchAction {
    Schedule {
        scheduled_at: Option<String>,
        duration_minutes: Option<i32>,
        venue: Option<String>,
        station: Option<String>,
    },
    Call,
    Delay {
        minutes: i32,
        reason: String,
    },
    Attendance {
        participant_id: Uuid,
        status: AttendanceStatus,
        reason: Option<String>,
    },
    Submit {
        report: Report,
    },
    Confirm {
        submission_id: Uuid,
    },
    Dispute {
        submission_id: Option<Uuid>,
        reason: String,
        evidence: Vec<Uuid>,
    },
    Resolve {
        dispute_id: Uuid,
        submission_id: Uuid,
        accepted: bool,
        reason: String,
    },
    Adjudicate {
        report: Report,
        reason: String,
    },
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct WorkflowRequest {
    pub operation_id: Uuid,
    pub revision: i64,
    pub action: MatchAction,
}

#[derive(Serialize, ToSchema)]
struct WorkflowView {
    workflow: MatchWorkflow,
    participant_id: Option<Uuid>,
    can_manage: bool,
    identities: BTreeMap<Uuid, String>,
}

async fn workflow_identities(
    state: &AppState,
    members: &[MatchParticipant],
    workflow: &MatchWorkflow,
) -> Result<BTreeMap<Uuid, String>, ApiError> {
    let mut identities = BTreeMap::new();
    let mut users: std::collections::HashSet<Uuid> =
        workflow.history.iter().map(|h| h.actor_id).collect();
    for member in members {
        if let Some(participant) = state
            .store
            .find_participant(member.participant_id)
            .await
            .map_err(ApiError::internal)?
        {
            if let Some(user_id) = participant.user_id {
                users.insert(user_id);
                if let Some(profile) = state
                    .store
                    .find_profile(user_id)
                    .await
                    .map_err(ApiError::internal)?
                {
                    identities.insert(member.participant_id, profile.username);
                }
            } else if let Some(team_id) = participant.tournament_team_id {
                if let Some(team) = state
                    .store
                    .find_tournament_team(team_id)
                    .await
                    .map_err(ApiError::internal)?
                {
                    identities.insert(member.participant_id, team.name);
                }
                for player in state
                    .store
                    .list_tournament_team_members(team_id)
                    .await
                    .map_err(ApiError::internal)?
                    .unwrap_or_default()
                {
                    users.insert(player.user_id);
                }
            }
        }
    }
    for id in users {
        if let Some(profile) = state
            .store
            .find_profile(id)
            .await
            .map_err(ApiError::internal)?
        {
            identities.insert(id, profile.username);
        }
    }
    Ok(identities)
}

pub(crate) async fn participant_for(
    state: &AppState,
    claims: &Claims,
    members: &[MatchParticipant],
) -> Result<Option<Uuid>, ApiError> {
    let mut owned = Vec::new();
    for member in members {
        let participant = state
            .store
            .find_participant(member.participant_id)
            .await
            .map_err(ApiError::internal)?
            .ok_or(ApiError::NotFound)?;
        if !matches!(
            participant.status,
            ParticipantStatus::Registered | ParticipantStatus::CheckedIn
        ) {
            continue;
        }
        let represents = if participant.user_id == Some(claims.sub) {
            true
        } else if let Some(id) = participant.tournament_team_id {
            state
                .store
                .find_tournament_team(id)
                .await
                .map_err(ApiError::internal)?
                .is_some_and(|team| team.owner_id == claims.sub)
        } else {
            false
        };
        if represents {
            owned.push(participant.id);
        }
    }
    // An account representing both sides cannot independently confirm either side.
    Ok(if owned.len() == 1 {
        owned.first().copied()
    } else {
        None
    })
}

#[utoipa::path(get, path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}/workflow", tag = "matches", security(("bearer" = [])), params(("id" = Uuid, Path), ("step_id" = Uuid, Path), ("match_id" = Uuid, Path)), responses((status = 200, description = "Reports, scheduling and audit", body = WorkflowView)))]
#[get("/tournaments/{id}/steps/{step_id}/matches/{match_id}/workflow")]
async fn get_workflow(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tid, sid, mid) = path.into_inner();
    let tournament = visible_tournament(&state, &claims, tid).await?;
    let step = find_step(&state, tid, sid).await?;
    let current = find_match(&state, &step, mid).await?;
    let members = match_participants(&state, &step, mid).await?;
    let access = access_of(&state, &claims, &tournament).await?;
    let participant_id = participant_for(&state, &claims, &members).await?;
    if !access.can_manage() && participant_id.is_none() {
        return Err(ApiError::Forbidden);
    }
    let mut workflow = state.store.match_workflow(mid).await.map_err(match_error)?;
    if workflow.revision == 0 {
        workflow.schedule.scheduled_at = current.scheduled_at;
    }
    Ok(HttpResponse::Ok().json(WorkflowView {
        identities: workflow_identities(&state, &members, &workflow).await?,
        workflow,
        participant_id,
        can_manage: access.can_manage(),
    }))
}

pub(crate) fn required_reason(value: &str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 2000 {
        return Err(invalid(
            "reason",
            "A reason of 1 to 2000 characters is required.",
        ));
    }
    Ok(value.to_string())
}

pub(crate) fn schedule_text(value: Option<String>) -> Result<Option<String>, ApiError> {
    match value {
        Some(value) if value.trim().chars().count() > 160 => Err(invalid(
            "schedule",
            "Venue and station must not exceed 160 characters.",
        )),
        Some(value) if !value.trim().is_empty() => Ok(Some(value.trim().to_string())),
        _ => Ok(None),
    }
}

pub(crate) fn import_games(games: &[ReportedGame]) -> Vec<GameImport> {
    games
        .iter()
        .map(|game| GameImport {
            status: MatchStatus::Finished,
            attributes: game.attributes.clone(),
            started_at: None,
            ended_at: Some(now_rfc3339()),
            participants: game.results.clone(),
        })
        .collect()
}

#[utoipa::path(post, path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}/workflow", tag = "matches", security(("bearer" = [])), params(("id" = Uuid, Path), ("step_id" = Uuid, Path), ("match_id" = Uuid, Path)), request_body = WorkflowRequest, responses((status = 200, description = "Atomic workflow update", body = WorkflowView)))]
#[post("/tournaments/{id}/steps/{step_id}/matches/{match_id}/workflow")]
async fn update_workflow(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid, Uuid)>,
    body: web::Json<WorkflowRequest>,
) -> Result<HttpResponse, ApiError> {
    let (tid, sid, mid) = path.into_inner();
    let tournament = visible_tournament(&state, &claims, tid).await?;
    let step = find_step(&state, tid, sid).await?;
    let current = find_match(&state, &step, mid).await?;
    let members = match_participants(&state, &step, mid).await?;
    let access = access_of(&state, &claims, &tournament).await?;
    if access.watcher {
        return Err(ApiError::Forbidden);
    }
    let can_manage = access.can_manage();
    let participant_id = participant_for(&state, &claims, &members).await?;
    if !can_manage && participant_id.is_none() {
        return Err(ApiError::Forbidden);
    }
    let request = body.into_inner();
    let fingerprint = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(claims.sub, &request.action)).map_err(ApiError::internal)?
        )
    );
    let mut workflow = state.store.match_workflow(mid).await.map_err(match_error)?;
    if let Some(receipt) = workflow
        .receipts
        .iter()
        .find(|receipt| receipt.id == request.operation_id)
    {
        if receipt.fingerprint != fingerprint {
            return Err(ApiError::InvalidTransition);
        }
        return Ok(HttpResponse::Ok().json(WorkflowView {
            identities: workflow_identities(&state, &members, &workflow).await?,
            workflow,
            participant_id,
            can_manage,
        }));
    }
    if workflow.revision != request.revision {
        return Err(ApiError::InvalidTransition);
    }
    if workflow.revision == 0 {
        workflow.schedule.scheduled_at = current.scheduled_at.clone();
    }
    let contest_finished = current.status == MatchStatus::Finished
        && matches!(&request.action, MatchAction::Dispute { .. });
    if !contest_finished
        && (matches!(
            current.status,
            MatchStatus::Finished | MatchStatus::Cancelled
        ) || step.status != StepStatus::Ongoing
            || tournament.status != TournamentStatus::Ongoing)
    {
        return Err(ApiError::InvalidTransition);
    }
    let before =
        json!({ "match": current, "participants": members, "schedule": workflow.schedule });
    let after = serde_json::to_value(&request.action).map_err(ApiError::internal)?;
    let now = now_rfc3339();
    let mut finish = None;
    let mut games = None;
    let mut reason = None;
    let mut accept = None;
    let event;
    match request.action {
        MatchAction::Schedule {
            scheduled_at,
            duration_minutes,
            venue,
            station,
        } => {
            if !can_manage {
                return Err(ApiError::Forbidden);
            }
            if current.status != MatchStatus::Scheduled
                || duration_minutes.is_some_and(|value| !(1..=1440).contains(&value))
            {
                return Err(invalid(
                    "schedule",
                    "Only scheduled matches accept a duration of 1 to 1440 minutes.",
                ));
            }
            workflow.schedule.round_default = false;
            workflow.schedule.scheduled_at = scheduled_at
                .map(|value| {
                    crate::team_io::normalize_timestamp(&value)
                        .ok_or_else(|| invalid("scheduled_at", "Use an RFC3339 timestamp."))
                })
                .transpose()?;
            workflow.schedule.duration_minutes = duration_minutes;
            workflow.schedule.venue = schedule_text(venue)?;
            workflow.schedule.station = schedule_text(station)?;
            event = "match.rescheduled";
        }
        MatchAction::Call => {
            if !can_manage {
                return Err(ApiError::Forbidden);
            }
            workflow.schedule.called_at = Some(now.clone());
            event = "match.called";
        }
        MatchAction::Delay {
            minutes,
            reason: explanation,
        } => {
            if !can_manage {
                return Err(ApiError::Forbidden);
            }
            if !(1..=1440).contains(&minutes) {
                return Err(invalid(
                    "minutes",
                    "Delay must be between 1 and 1440 minutes.",
                ));
            }
            reason = Some(required_reason(&explanation)?);
            workflow.schedule.delay_minutes = minutes;
            event = "match.rescheduled";
        }
        MatchAction::Attendance {
            participant_id: id,
            status,
            reason: explanation,
        } => {
            if !can_manage {
                return Err(ApiError::Forbidden);
            }
            if !members.iter().any(|p| p.participant_id == id) {
                return Err(invalid(
                    "participant_id",
                    "Participant does not belong to this match.",
                ));
            }
            if matches!(status, AttendanceStatus::Absent | AttendanceStatus::Forfeit) {
                reason = Some(required_reason(explanation.as_deref().unwrap_or_default())?);
            }
            workflow.attendance.insert(
                id,
                Attendance {
                    status,
                    reason: reason.clone(),
                    actor_id: claims.sub,
                    updated_at: now.clone(),
                },
            );
            if status == AttendanceStatus::Forfeit && step.match_type == MatchType::Duel {
                if members.len() != 2 {
                    return Err(ApiError::InvalidTransition);
                }
                let scores: Vec<MatchScore> = members
                    .iter()
                    .map(|p| MatchScore {
                        participant_id: p.participant_id,
                        stats: json!({}),
                        points: 0.0,
                        rank: Some(if p.participant_id == id { 2 } else { 1 }),
                        result: Some(if p.participant_id == id {
                            MatchResult::Loss
                        } else {
                            MatchResult::Win
                        }),
                        games_won: Some(if p.participant_id == id {
                            0
                        } else {
                            current.best_of / 2 + 1
                        }),
                        slot: p.slot,
                    })
                    .collect();
                finish = Some(
                    prepare_series_finish(
                        &state,
                        &step,
                        &current,
                        &score_members(mid, &scores),
                        None,
                    )
                    .await?,
                );
            }
            event = "match.attendance";
        }
        MatchAction::Submit { report } => {
            let id = participant_id.ok_or(ApiError::Forbidden)?;
            if !state
                .store
                .list_match_games(mid)
                .await
                .map_err(ApiError::internal)?
                .is_empty()
            {
                return Err(ApiError::InvalidTransition);
            }
            let (mut results, reported_games) =
                validate_report(&state, &tournament, &step, &current, &report).await?;
            // Validate completeness and progression without changing authoritative state.
            results =
                prepare_series_finish(&state, &step, &current, &score_members(mid, &results), None)
                    .await?
                    .scores;
            if let Some(existing) = workflow.submissions.iter_mut().find(|s| {
                s.status == SubmissionStatus::Pending
                    && s.results == results
                    && s.games == reported_games
            }) {
                if existing.actor_id == claims.sub
                    || existing
                        .confirmations
                        .values()
                        .any(|actor| *actor == claims.sub)
                {
                    return Err(ApiError::InvalidTransition);
                }
                existing.confirmations.insert(id, claims.sub);
                if existing.confirmations.len() == members.len() {
                    accept = Some(existing.id);
                }
            } else {
                let conflict = workflow.submissions.iter().any(|s| {
                    matches!(
                        s.status,
                        SubmissionStatus::Pending | SubmissionStatus::Disputed
                    )
                });
                if conflict {
                    for submission in &mut workflow.submissions {
                        if submission.status == SubmissionStatus::Pending {
                            submission.status = SubmissionStatus::Disputed;
                        }
                    }
                    workflow.disputes.push(Dispute {
                        id: Uuid::new_v4(),
                        submission_id: None,
                        actor_id: claims.sub,
                        reason: "Conflicting result submissions".to_string(),
                        evidence: Vec::new(),
                        created_at: now.clone(),
                        decision: None,
                    });
                }
                workflow.submissions.push(ResultSubmission {
                    id: Uuid::new_v4(),
                    actor_id: claims.sub,
                    participant_id: id,
                    status: if conflict {
                        SubmissionStatus::Disputed
                    } else {
                        SubmissionStatus::Pending
                    },
                    results,
                    games: reported_games,
                    confirmations: BTreeMap::from([(id, claims.sub)]),
                    created_at: now.clone(),
                });
            }
            event = "match.result_submitted";
        }
        MatchAction::Confirm { submission_id } => {
            let id = participant_id.ok_or(ApiError::Forbidden)?;
            if workflow.disputes.iter().any(|d| d.decision.is_none()) {
                return Err(ApiError::InvalidTransition);
            }
            let submission = workflow
                .submissions
                .iter_mut()
                .find(|s| s.id == submission_id && s.status == SubmissionStatus::Pending)
                .ok_or(ApiError::InvalidTransition)?;
            if submission.actor_id == claims.sub
                || submission.confirmations.contains_key(&id)
                || submission
                    .confirmations
                    .values()
                    .any(|actor| *actor == claims.sub)
            {
                return Err(ApiError::InvalidTransition);
            }
            submission.confirmations.insert(id, claims.sub);
            if submission.confirmations.len() == members.len() {
                accept = Some(submission_id);
            }
            event = "match.confirmed";
        }
        MatchAction::Dispute {
            submission_id,
            reason: explanation,
            evidence,
        } => {
            if participant_id.is_none() {
                return Err(ApiError::Forbidden);
            }
            reason = Some(required_reason(&explanation)?);
            if evidence.len() > 5 {
                return Err(invalid(
                    "evidence",
                    "At most five attachments are accepted.",
                ));
            }
            for id in &evidence {
                let attachment = state
                    .store
                    .match_evidence(*id)
                    .await
                    .map_err(ApiError::internal)?
                    .ok_or(ApiError::NotFound)?;
                if attachment.match_id != mid || attachment.actor_id != claims.sub {
                    return Err(ApiError::Forbidden);
                }
            }
            if let Some(id) = submission_id {
                let submission = workflow
                    .submissions
                    .iter_mut()
                    .find(|s| s.id == id && s.status != SubmissionStatus::Rejected)
                    .ok_or(ApiError::NotFound)?;
                submission.status = SubmissionStatus::Disputed;
            }
            workflow.disputes.push(Dispute {
                id: Uuid::new_v4(),
                submission_id,
                actor_id: claims.sub,
                reason: reason.clone().unwrap_or_default(),
                evidence,
                created_at: now.clone(),
                decision: None,
            });
            event = "match.disputed";
        }
        MatchAction::Resolve {
            dispute_id,
            submission_id,
            accepted,
            reason: explanation,
        } => {
            if !can_manage {
                return Err(ApiError::Forbidden);
            }
            reason = Some(required_reason(&explanation)?);
            if !workflow.submissions.iter().any(|s| s.id == submission_id) {
                return Err(ApiError::NotFound);
            }
            let dispute = workflow
                .disputes
                .iter_mut()
                .find(|d| d.id == dispute_id && d.decision.is_none())
                .ok_or(ApiError::InvalidTransition)?;
            dispute.decision = Some(DisputeDecision {
                actor_id: claims.sub,
                reason: reason.clone().unwrap_or_default(),
                accepted,
                decided_at: now.clone(),
            });
            if !workflow.disputes.iter().any(|d| d.decision.is_none()) {
                accept = Some(submission_id);
            }
            event = "match.resolved";
        }
        MatchAction::Adjudicate {
            report,
            reason: explanation,
        } => {
            if !can_manage {
                return Err(ApiError::Forbidden);
            }
            reason = Some(required_reason(&explanation)?);
            let (scores, reported_games) =
                validate_report(&state, &tournament, &step, &current, &report).await?;
            finish = Some(
                prepare_series_finish(&state, &step, &current, &score_members(mid, &scores), None)
                    .await?,
            );
            if !reported_games.is_empty() {
                games = Some(import_games(&reported_games));
            }
            event = "match.resolved";
        }
    }
    if let Some(id) = accept {
        if workflow.disputes.iter().any(|d| d.decision.is_none()) {
            return Err(ApiError::InvalidTransition);
        }
        let submission = workflow
            .submissions
            .iter()
            .find(|s| s.id == id)
            .ok_or(ApiError::NotFound)?;
        let expected: std::collections::HashSet<Uuid> =
            members.iter().map(|p| p.participant_id).collect();
        let reported: std::collections::HashSet<Uuid> = submission
            .results
            .iter()
            .map(|p| p.participant_id)
            .collect();
        if expected != reported
            || !state
                .store
                .list_match_games(mid)
                .await
                .map_err(ApiError::internal)?
                .is_empty()
        {
            return Err(ApiError::InvalidTransition);
        }
        finish = Some(
            prepare_series_finish(
                &state,
                &step,
                &current,
                &score_members(mid, &submission.results),
                None,
            )
            .await?,
        );
        if !submission.games.is_empty() {
            games = Some(import_games(&submission.games));
        }
        for submission in &mut workflow.submissions {
            submission.status = if submission.id == id {
                SubmissionStatus::Accepted
            } else {
                SubmissionStatus::Rejected
            };
        }
    }
    let finished = finish.is_some();
    if finished && accept.is_none() {
        for submission in &mut workflow.submissions {
            submission.status = SubmissionStatus::Rejected;
        }
        for dispute in &mut workflow.disputes {
            if dispute.decision.is_none() {
                dispute.decision = Some(DisputeDecision {
                    actor_id: claims.sub,
                    reason: reason.clone().unwrap_or_default(),
                    accepted: false,
                    decided_at: now.clone(),
                });
            }
        }
    }
    workflow.revision += 1;
    workflow.receipts.push(OperationReceipt {
        id: request.operation_id,
        fingerprint,
    });
    workflow.history.push(MatchAuditEntry {
        id: request.operation_id,
        actor_id: claims.sub,
        action: event.to_string(),
        reason,
        created_at: now,
        before,
        after,
    });
    let workflow = state
        .store
        .commit_match_workflow(WorkflowCommit {
            match_id: mid,
            expected_revision: request.revision,
            expected_updated_at: current.updated_at,
            workflow,
            finish,
            games,
        })
        .await
        .map_err(match_error)?;
    let mut notification = crate::notifications::match_event(
        event,
        &tournament,
        sid,
        mid,
        members.iter().map(|p| p.participant_id).collect(),
    );
    notification.key = format!("{event}:{mid}:{}", request.operation_id);
    crate::notifications::emit(&state, notification);
    if event == "match.result_submitted" && !finished {
        let recipients = members
            .iter()
            .filter(|p| Some(p.participant_id) != participant_id)
            .map(|p| p.participant_id)
            .collect();
        let mut requested = crate::notifications::match_event(
            "match.confirmation_requested",
            &tournament,
            sid,
            mid,
            recipients,
        );
        requested.key = format!(
            "match.confirmation_requested:{mid}:{}",
            request.operation_id
        );
        crate::notifications::emit(&state, requested);
    }
    if finished {
        close_if_complete(&state, &tournament, &step).await;
    }
    Ok(HttpResponse::Ok().json(WorkflowView {
        identities: workflow_identities(&state, &members, &workflow).await?,
        workflow,
        participant_id,
        can_manage,
    }))
}
