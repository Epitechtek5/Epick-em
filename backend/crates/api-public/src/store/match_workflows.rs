//! Match operations that must remain separate from authoritative results.

use super::{GameImport, MatchFinish, MatchGame, MatchScore};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct MatchSchedule {
    #[serde(default)]
    pub round_default: bool,
    pub scheduled_at: Option<String>,
    pub duration_minutes: Option<i32>,
    pub venue: Option<String>,
    pub station: Option<String>,
    pub called_at: Option<String>,
    pub delay_minutes: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AttendanceStatus {
    Expected,
    Present,
    Late,
    Absent,
    Forfeit,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Attendance {
    pub status: AttendanceStatus,
    pub reason: Option<String>,
    pub actor_id: Uuid,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SubmissionStatus {
    Pending,
    Disputed,
    Accepted,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ReportedGame {
    pub attributes: serde_json::Value,
    pub results: Vec<MatchScore>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ResultSubmission {
    pub id: Uuid,
    pub actor_id: Uuid,
    pub participant_id: Uuid,
    pub status: SubmissionStatus,
    pub results: Vec<MatchScore>,
    pub games: Vec<ReportedGame>,
    /// Participant IDs, not account IDs: one team has one confirmation.
    pub confirmations: BTreeMap<Uuid, Uuid>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Dispute {
    pub id: Uuid,
    pub submission_id: Option<Uuid>,
    pub actor_id: Uuid,
    pub reason: String,
    pub evidence: Vec<Uuid>,
    pub created_at: String,
    pub decision: Option<DisputeDecision>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct DisputeDecision {
    pub actor_id: Uuid,
    pub reason: String,
    pub accepted: bool,
    pub decided_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct MatchAuditEntry {
    pub id: Uuid,
    pub actor_id: Uuid,
    pub action: String,
    pub reason: Option<String>,
    pub created_at: String,
    pub before: serde_json::Value,
    pub after: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct OperationReceipt {
    pub id: Uuid,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct MatchWorkflow {
    pub revision: i64,
    pub schedule: MatchSchedule,
    pub attendance: BTreeMap<Uuid, Attendance>,
    pub submissions: Vec<ResultSubmission>,
    pub disputes: Vec<Dispute>,
    pub history: Vec<MatchAuditEntry>,
    pub receipts: Vec<OperationReceipt>,
}

/// A compare-and-swap update. Finalization and submitted games share its transaction.
#[derive(Debug, Clone)]
pub struct WorkflowCommit {
    pub match_id: Uuid,
    pub expected_revision: i64,
    pub expected_updated_at: String,
    pub workflow: MatchWorkflow,
    pub finish: Option<MatchFinish>,
    pub games: Option<Vec<GameImport>>,
    /// Exact previous games retained in the audit before an administrative forfeit.
    pub archive_games: Option<Vec<MatchGame>>,
}

#[derive(Debug, Clone)]
pub struct MatchEvidence {
    pub id: Uuid,
    pub match_id: Uuid,
    pub actor_id: Uuid,
    pub filename: String,
    pub media_type: String,
    pub bytes: Vec<u8>,
    pub created_at: String,
}

impl MatchWorkflow {
    pub fn requires_decision(&self) -> bool {
        self.submissions.iter().any(|submission| {
            matches!(
                submission.status,
                SubmissionStatus::Pending | SubmissionStatus::Disputed
            )
        }) || self
            .disputes
            .iter()
            .any(|dispute| dispute.decision.is_none())
    }

    pub fn accepts(&self, next: &Self, revision: i64) -> bool {
        self.revision == revision
            && revision.checked_add(1) == Some(next.revision)
            && next.history.starts_with(&self.history)
            && next.receipts.starts_with(&self.receipts)
    }
}
