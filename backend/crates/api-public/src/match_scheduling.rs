//! Atomic round defaults preserve individually scheduled matches.
use crate::auth::{AppState, Claims};
use crate::error::ApiError;
use crate::match_reports::invalid;
use crate::match_workflows::schedule_text;
use crate::matches::match_error;
use crate::steps::find_step;
use crate::store::*;
use crate::tournament_access::access_of;
use crate::tournaments::visible_tournament;
use actix_web::{HttpResponse, post, web};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use utoipa::ToSchema;
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(schedule_round);
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RoundScheduleRequest {
    pub operation_id: Uuid,
    pub scheduled_at: Option<String>,
    pub duration_minutes: Option<i32>,
    pub venue: Option<String>,
    pub station: Option<String>,
}

#[utoipa::path(post, path = "/tournaments/{id}/steps/{step_id}/rounds/{round}/schedule", tag = "matches", security(("bearer" = [])), params(("id" = Uuid, Path), ("step_id" = Uuid, Path), ("round" = i32, Path)), request_body = RoundScheduleRequest, responses((status = 200, description = "Scheduled matches inherit round defaults; individual overrides are preserved")))]
#[post("/tournaments/{id}/steps/{step_id}/rounds/{round}/schedule")]
async fn schedule_round(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid, i32)>,
    body: web::Json<RoundScheduleRequest>,
) -> Result<HttpResponse, ApiError> {
    let (tid, sid, round) = path.into_inner();
    let tournament = visible_tournament(&state, &claims, tid).await?;
    if !access_of(&state, &claims, &tournament).await?.can_manage() {
        return Err(ApiError::Forbidden);
    }
    let step = find_step(&state, tid, sid).await?;
    if round < 1
        || body
            .duration_minutes
            .is_some_and(|n| !(1..=1440).contains(&n))
    {
        return Err(invalid("schedule", "Invalid round or duration."));
    }
    let fingerprint = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(claims.sub, round, &*body)).map_err(ApiError::internal)?
        )
    );
    let scheduled_at = body
        .scheduled_at
        .as_ref()
        .map(|s| {
            crate::team_io::normalize_timestamp(s)
                .ok_or_else(|| invalid("scheduled_at", "Use an RFC3339 timestamp."))
        })
        .transpose()?;
    let venue = schedule_text(body.venue.clone())?;
    let station = schedule_text(body.station.clone())?;
    let matches: Vec<Match> = state
        .store
        .list_matches(sid, None, None)
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        .filter(|m| m.round == Some(round))
        .collect();
    if matches.is_empty() {
        return Err(ApiError::NotFound);
    }
    let mut updates = Vec::new();
    let mut already_applied = false;
    for m in &matches {
        let mut workflow = state
            .store
            .match_workflow(m.id)
            .await
            .map_err(ApiError::internal)?;
        if let Some(receipt) = workflow.receipts.iter().find(|r| r.id == body.operation_id) {
            if receipt.fingerprint != fingerprint {
                return Err(ApiError::InvalidTransition);
            }
            already_applied = true;
            continue;
        }
        if m.status != MatchStatus::Scheduled {
            continue;
        }
        let individual = !workflow.schedule.round_default
            && (m.scheduled_at.is_some()
                || workflow
                    .history
                    .iter()
                    .any(|h| h.action == "match.rescheduled"));
        if individual {
            continue;
        }
        let before = json!(workflow.schedule);
        let revision = workflow.revision;
        workflow.revision += 1;
        workflow.schedule.round_default = true;
        workflow.schedule.scheduled_at = scheduled_at.clone();
        workflow.schedule.duration_minutes = body.duration_minutes;
        workflow.schedule.venue = venue.clone();
        workflow.schedule.station = station.clone();
        workflow.receipts.push(OperationReceipt {
            id: body.operation_id,
            fingerprint: fingerprint.clone(),
        });
        workflow.history.push(MatchAuditEntry {
            id: body.operation_id,
            actor_id: claims.sub,
            action: "match.rescheduled".into(),
            reason: None,
            created_at: now_rfc3339(),
            before,
            after: json!({"round":round,"schedule":workflow.schedule}),
        });
        updates.push(WorkflowCommit {
            match_id: m.id,
            expected_revision: revision,
            expected_updated_at: m.updated_at.clone(),
            workflow,
            finish: None,
            games: None,
        });
    }
    if already_applied {
        return Ok(HttpResponse::Ok().json(json!({"updated":0,"replayed":true})));
    }
    if step.status != StepStatus::Ongoing || tournament.status != TournamentStatus::Ongoing {
        return Err(ApiError::InvalidTransition);
    }
    let changed: Vec<Uuid> = updates.iter().map(|u| u.match_id).collect();
    state
        .store
        .commit_schedule_batch(updates)
        .await
        .map_err(match_error)?;
    let members = state
        .store
        .list_step_match_participants(sid)
        .await
        .map_err(ApiError::internal)?;
    for mid in &changed {
        let mut event = crate::notifications::match_event(
            "match.rescheduled",
            &tournament,
            sid,
            *mid,
            members
                .iter()
                .filter(|p| p.match_id == *mid)
                .map(|p| p.participant_id)
                .collect(),
        );
        event.key = format!("match.rescheduled:{mid}:{}", body.operation_id);
        crate::notifications::emit(&state, event);
    }
    Ok(HttpResponse::Ok().json(json!({"updated":changed.len(),"replayed":false})))
}
