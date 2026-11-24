//! Private, size-limited evidence. Downloads always require match authorization.

use crate::auth::{AppState, Claims};
use crate::error::ApiError;
use crate::match_reports::invalid;
use crate::match_workflows::participant_for;
use crate::matches::{find_match, match_participants};
use crate::steps::find_step;
use crate::store::{MatchEvidence, now_rfc3339};
use crate::tournament_access::access_of;
use crate::tournaments::visible_tournament;
use actix_web::{HttpRequest, HttpResponse, get, put, web};
use serde::Serialize;
use utoipa::ToSchema;
use utoipa_actix_web::service_config::ServiceConfig;
use uuid::Uuid;

pub fn routes(cfg: &mut ServiceConfig) {
    cfg.service(upload).service(download);
}

#[derive(Serialize, ToSchema)]
struct EvidenceInfo {
    id: Uuid,
    filename: String,
    media_type: String,
    size: usize,
}

async fn authorize(
    state: &AppState,
    claims: &Claims,
    tid: Uuid,
    sid: Uuid,
    mid: Uuid,
) -> Result<bool, ApiError> {
    let tournament = visible_tournament(state, claims, tid).await?;
    let step = find_step(state, tid, sid).await?;
    find_match(state, &step, mid).await?;
    let manager = access_of(state, claims, &tournament).await?.can_manage();
    let members = match_participants(state, &step, mid).await?;
    if !manager && participant_for(state, claims, &members).await?.is_none() {
        return Err(ApiError::Forbidden);
    }
    Ok(manager)
}

fn validate_file(bytes: &[u8], media_type: &str) -> bool {
    if bytes.is_empty() || bytes.len() > 5 * 1024 * 1024 {
        return false;
    }
    match media_type {
        "image/png" => {
            bytes.len() >= 45
                && bytes.starts_with(b"\x89PNG\r\n\x1a\n")
                && &bytes[12..16] == b"IHDR"
                && bytes[bytes.len() - 12..].starts_with(b"\0\0\0\0IEND")
        }
        "image/jpeg" => {
            bytes.len() >= 4 && bytes.starts_with(b"\xff\xd8\xff") && bytes.ends_with(b"\xff\xd9")
        }
        "application/pdf" => {
            bytes.starts_with(b"%PDF-")
                && bytes.len() >= 12
                && bytes[bytes.len().saturating_sub(1024)..]
                    .windows(5)
                    .any(|part| part == b"%%EOF")
        }
        _ => false,
    }
}

#[utoipa::path(put, path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}/evidence/{evidence_id}", tag = "matches", security(("bearer" = [])), params(("id" = Uuid, Path), ("step_id" = Uuid, Path), ("match_id" = Uuid, Path), ("evidence_id" = Uuid, Path)), request_body(content = String, content_type = "application/octet-stream"), responses((status = 200, description = "Private evidence stored", body = EvidenceInfo)))]
#[put("/tournaments/{id}/steps/{step_id}/matches/{match_id}/evidence/{evidence_id}")]
async fn upload(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid, Uuid, Uuid)>,
    request: HttpRequest,
    bytes: web::Bytes,
) -> Result<HttpResponse, ApiError> {
    let (tid, sid, mid, id) = path.into_inner();
    authorize(&state, &claims, tid, sid, mid).await?;
    let media_type = request
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !validate_file(&bytes, media_type) {
        return Err(invalid(
            "evidence",
            "Provide a PNG, JPEG or PDF file no larger than 5 MiB.",
        ));
    }
    let filename = request
        .headers()
        .get("x-filename")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("evidence");
    if filename.is_empty()
        || filename.chars().count() > 160
        || filename
            .chars()
            .any(|ch| ch.is_control() || ['/', '\\', '"'].contains(&ch))
    {
        return Err(invalid("filename", "Invalid evidence filename."));
    }
    if let Some(existing) = state
        .store
        .match_evidence(id)
        .await
        .map_err(ApiError::internal)?
    {
        if existing.match_id != mid
            || existing.actor_id != claims.sub
            || existing.media_type != media_type
            || existing.bytes.as_slice() != bytes.as_ref()
            || existing.filename != filename
        {
            return Err(ApiError::InvalidTransition);
        }
    } else {
        state
            .store
            .insert_match_evidence(MatchEvidence {
                id,
                match_id: mid,
                actor_id: claims.sub,
                filename: filename.to_string(),
                media_type: media_type.to_string(),
                bytes: bytes.to_vec(),
                created_at: now_rfc3339(),
            })
            .await
            .map_err(ApiError::internal)?;
    }
    Ok(HttpResponse::Ok().json(EvidenceInfo {
        id,
        filename: filename.to_string(),
        media_type: media_type.to_string(),
        size: bytes.len(),
    }))
}

#[utoipa::path(get, path = "/tournaments/{id}/steps/{step_id}/matches/{match_id}/evidence/{evidence_id}", tag = "matches", security(("bearer" = [])), params(("id" = Uuid, Path), ("step_id" = Uuid, Path), ("match_id" = Uuid, Path), ("evidence_id" = Uuid, Path)), responses((status = 200, description = "Authorized evidence download")))]
#[get("/tournaments/{id}/steps/{step_id}/matches/{match_id}/evidence/{evidence_id}")]
async fn download(
    state: web::Data<AppState>,
    claims: web::ReqData<Claims>,
    path: web::Path<(Uuid, Uuid, Uuid, Uuid)>,
) -> Result<HttpResponse, ApiError> {
    let (tid, sid, mid, id) = path.into_inner();
    let manager = authorize(&state, &claims, tid, sid, mid).await?;
    let evidence = state
        .store
        .match_evidence(id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound)?;
    if evidence.match_id != mid {
        return Err(ApiError::NotFound);
    }
    let workflow = state
        .store
        .match_workflow(mid)
        .await
        .map_err(ApiError::internal)?;
    if !manager
        && evidence.actor_id != claims.sub
        && !workflow.disputes.iter().any(|d| d.evidence.contains(&id))
    {
        return Err(ApiError::Forbidden);
    }
    let extension = match evidence.media_type.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        _ => "pdf",
    };
    Ok(HttpResponse::Ok()
        .content_type(evidence.media_type)
        .insert_header((
            "Content-Disposition",
            format!("attachment; filename=\"evidence-{id}.{extension}\""),
        ))
        .insert_header(("Cache-Control", "private, no-store"))
        .insert_header(("X-Content-Type-Options", "nosniff"))
        .insert_header(("Content-Security-Policy", "sandbox; default-src 'none'"))
        .body(evidence.bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evidence_checks_content_and_size_instead_of_trusting_extensions() {
        assert!(!validate_file(b"<script>alert(1)</script>", "image/png"));
        assert!(!validate_file(b"%PDF-1.7\n", "application/pdf"));
        assert!(validate_file(b"%PDF-1.7\n%%EOF", "application/pdf"));
        assert!(!validate_file(&vec![0; 5 * 1024 * 1024 + 1], "image/jpeg"));
        assert!(!validate_file(b"data", "text/html"));
    }
}
