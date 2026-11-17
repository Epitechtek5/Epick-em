//! Preview and atomically replay corrected results through the existing tournament engines.
use crate::auth::{AppState, Claims};
use crate::error::ApiError;
use crate::match_reports::{Report, score_members, validate_report};
use crate::match_workflows::{import_games, required_reason};
use crate::matches::{find_match, is_complete, match_error, prepare_series_finish};
use crate::steps::{close_step_of, find_step};
use crate::store::*;
use crate::tournament_access::access_of;
use crate::tournaments::visible_tournament;
use actix_web::{HttpResponse, post, web};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, sync::Arc};
use utoipa::ToSchema;
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(preview_correction).service(correct);
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CorrectionInput {
    pub report: Report,
    pub reason: String,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CorrectionRequest {
    pub operation_id: Uuid,
    pub revision: String,
    pub reset_downstream: bool,
    pub report: Report,
    pub reason: String,
}

#[derive(Serialize, ToSchema)]
pub struct Impact {
    pub match_id: Uuid,
    pub step_id: Uuid,
    pub status: MatchStatus,
    pub archived: bool,
}
#[derive(Serialize, ToSchema)]
pub struct CorrectionPreview {
    pub revision: String,
    pub affected: Vec<Impact>,
    pub requires_resolution: bool,
}

fn impact(
    snapshot: &CompetitionSnapshot,
    current: &Match,
    step: &Step,
) -> (CorrectionPreview, Vec<Uuid>, Vec<Uuid>, Vec<Uuid>) {
    let later: Vec<Uuid> = snapshot
        .steps
        .iter()
        .filter(|s| s.position > step.position)
        .map(|s| s.id)
        .collect();
    let mut reset = HashSet::from([current.id]);
    loop {
        let old_len = reset.len();
        for m in &snapshot.matches {
            if reset.contains(&m.id) {
                reset.extend(m.next_match_id);
                reset.extend(m.loser_next_match_id);
            }
        }
        if old_len == reset.len() {
            break;
        }
    }
    let archive: Vec<Uuid> = snapshot
        .matches
        .iter()
        .filter(|m| {
            later.contains(&m.step_id)
                || (m.step_id == step.id
                    && step.format == StepFormat::Swiss
                    && m.round > current.round)
        })
        .map(|m| m.id)
        .collect();
    let affected: Vec<Impact> = snapshot
        .matches
        .iter()
        .filter(|m| m.id != current.id && (reset.contains(&m.id) || archive.contains(&m.id)))
        .map(|m| Impact {
            match_id: m.id,
            step_id: m.step_id,
            status: m.status,
            archived: archive.contains(&m.id),
        })
        .collect();
    let requires_resolution = !affected.is_empty();
    (
        CorrectionPreview {
            revision: String::new(),
            affected,
            requires_resolution,
        },
        reset.into_iter().collect(),
        archive,
        later,
    )
}

async fn plan(
    state: &AppState,
    tournament: &Tournament,
    step: &Step,
    current: &Match,
    report: &Report,
) -> Result<(CompetitionSnapshot, CompetitionSnapshot, CorrectionPreview), ApiError> {
    if current.status != MatchStatus::Finished {
        return Err(ApiError::InvalidTransition);
    }
    let before = state
        .store
        .competition_snapshot(tournament.id)
        .await
        .map_err(match_error)?;
    if !before
        .matches
        .iter()
        .any(|m| m.id == current.id && m.updated_at == current.updated_at)
    {
        return Err(ApiError::InvalidTransition);
    }
    let (mut preview, reset, archive, later) = impact(&before, current, step);
    preview.revision = before.revision().map_err(ApiError::internal)?;
    let (scores, games) = validate_report(state, tournament, step, current, report).await?;
    let memory = Arc::new(MemoryStore::from_competition(before.clone()));
    memory
        .reset_projected_matches(current.id, &reset, &archive, &later)
        .map_err(match_error)?;
    let mut projected = state.clone();
    projected.store = memory.clone();
    let projected_step = find_step(&projected, tournament.id, step.id).await?;
    let projected_match = find_match(&projected, &projected_step, current.id).await?;
    let finish = prepare_series_finish(
        &projected,
        &projected_step,
        &projected_match,
        &score_members(current.id, &scores),
        None,
    )
    .await?;
    let workflow = MatchWorkflow {
        revision: 1,
        ..Default::default()
    };
    memory
        .commit_match_workflow(WorkflowCommit {
            match_id: current.id,
            expected_revision: 0,
            expected_updated_at: projected_match.updated_at,
            workflow,
            finish: Some(finish),
            games: (!games.is_empty()).then(|| import_games(&games)),
        })
        .await
        .map_err(match_error)?;
    let matches = memory
        .list_matches(step.id, None, None)
        .await
        .map_err(ApiError::internal)?;
    let groups: Vec<Uuid> = memory
        .list_step_groups(step.id)
        .await
        .map_err(ApiError::internal)?
        .iter()
        .map(|g| g.id)
        .collect();
    if is_complete(&projected_step, &groups, &matches) {
        close_step_of(&projected, tournament, &projected_step).await?;
    } else if step.format == StepFormat::Swiss
        && matches
            .iter()
            .all(|m| matches!(m.status, MatchStatus::Finished | MatchStatus::Cancelled))
    {
        // An impossible pairing remains available for explicit organizer resolution.
        if let Err(error) =
            crate::generation::generate_next_round(&projected, tournament, &projected_step, false)
                .await
        {
            if !matches!(error, ApiError::Validation(_)) {
                return Err(error);
            }
        }
    }
    let next = memory
        .competition_snapshot(tournament.id)
        .await
        .map_err(ApiError::internal)?;
    Ok((before, next, preview))
}

#[utoipa::path(post, path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}/correction-preview", tag = "matches", security(("bearer" = [])), params(("id" = Uuid, Path), ("step_id" = Uuid, Path), ("match_id" = Uuid, Path)), request_body = CorrectionInput, responses((status = 200, body = CorrectionPreview)))]
#[post("/tournaments/{id}/steps/{step_id}/matches/{match_id}/correction-preview")]
async fn preview_correction(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid, Uuid)>,
    body: web::Json<CorrectionInput>,
) -> Result<HttpResponse, ApiError> {
    let (tid, sid, mid) = path.into_inner();
    let tournament = visible_tournament(&state, &claims, tid).await?;
    if !access_of(&state, &claims, &tournament).await?.can_manage() {
        return Err(ApiError::Forbidden);
    }
    required_reason(&body.reason)?;
    let step = find_step(&state, tid, sid).await?;
    let current = find_match(&state, &step, mid).await?;
    let (_, _, preview) = plan(&state, &tournament, &step, &current, &body.report).await?;
    Ok(HttpResponse::Ok().json(preview))
}

#[utoipa::path(post, path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}/corrections", tag = "matches", security(("bearer" = [])), params(("id" = Uuid, Path), ("step_id" = Uuid, Path), ("match_id" = Uuid, Path)), request_body = CorrectionRequest, responses((status = 200, body = MatchWorkflow)))]
#[post("/tournaments/{id}/steps/{step_id}/matches/{match_id}/corrections")]
async fn correct(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid, Uuid)>,
    body: web::Json<CorrectionRequest>,
) -> Result<HttpResponse, ApiError> {
    let (tid, sid, mid) = path.into_inner();
    let tournament = visible_tournament(&state, &claims, tid).await?;
    if !access_of(&state, &claims, &tournament).await?.can_manage() {
        return Err(ApiError::Forbidden);
    }
    let reason = required_reason(&body.reason)?;
    let fingerprint = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(claims.sub, &*body)).map_err(ApiError::internal)?)
    );
    let mut workflow = state.store.match_workflow(mid).await.map_err(match_error)?;
    if let Some(receipt) = workflow.receipts.iter().find(|r| r.id == body.operation_id) {
        if receipt.fingerprint != fingerprint {
            return Err(ApiError::InvalidTransition);
        }
        return Ok(HttpResponse::Ok().json(workflow));
    }
    let step = find_step(&state, tid, sid).await?;
    let current = find_match(&state, &step, mid).await?;
    let (before, next, preview) = plan(&state, &tournament, &step, &current, &body.report).await?;
    if body.revision != preview.revision || (preview.requires_resolution && !body.reset_downstream)
    {
        return Err(ApiError::InvalidTransition);
    }
    let expected_workflow_revision = workflow.revision;
    workflow.revision += 1;
    workflow.receipts.push(OperationReceipt {
        id: body.operation_id,
        fingerprint,
    });
    workflow.history.push(MatchAuditEntry { id: body.operation_id, actor_id: claims.sub, action: "match.corrected".to_string(), reason: Some(reason.clone()), created_at: now_rfc3339(), before: json!({"results":before.members.iter().filter(|m| m.match_id == mid).collect::<Vec<_>>(),"competition":before}), after: json!({"report": body.report, "impact": preview}) });
    for submission in &mut workflow.submissions {
        submission.status = SubmissionStatus::Rejected;
    }
    for dispute in &mut workflow.disputes {
        if dispute.decision.is_none() {
            dispute.decision = Some(DisputeDecision {
                actor_id: claims.sub,
                reason: reason.clone(),
                accepted: true,
                decided_at: now_rfc3339(),
            });
        }
    }
    state
        .store
        .commit_competition_correction(CompetitionCorrection {
            expected_revision: body.revision.clone(),
            next,
            match_id: mid,
            expected_workflow_revision,
            workflow: workflow.clone(),
        })
        .await
        .map_err(match_error)?;
    let recipients = before
        .members
        .iter()
        .filter(|m| m.match_id == mid)
        .map(|m| m.participant_id)
        .collect();
    let mut event =
        crate::notifications::match_event("match.corrected", &tournament, sid, mid, recipients);
    event.key = format!("match.corrected:{mid}:{}", body.operation_id);
    crate::notifications::emit(&state, event);
    Ok(HttpResponse::Ok().json(workflow))
}
