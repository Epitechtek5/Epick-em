//! A consistent competition snapshot used to plan and atomically apply corrections.

use super::*;
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize)]
pub struct CompetitionSnapshot {
    pub configuration: serde_json::Value,
    pub tournament: Tournament,
    pub steps: Vec<Step>,
    pub groups: Vec<StepGroup>,
    pub step_members: Vec<StepParticipant>,
    pub participants: Vec<TournamentParticipant>,
    pub matches: Vec<Match>,
    pub members: Vec<MatchParticipant>,
    pub games: Vec<MatchGame>,
}

impl CompetitionSnapshot {
    pub fn canonicalize(&mut self) {
        self.steps.sort_by_key(|s| s.id);
        self.groups.sort_by_key(|g| g.id);
        self.step_members
            .sort_by_key(|p| (p.step_id, p.participant_id));
        self.participants.sort_by_key(|p| p.id);
        self.matches.sort_by_key(|m| m.id);
        self.members.sort_by_key(|p| (p.match_id, p.participant_id));
        self.games.sort_by_key(|g| g.id);
        for game in &mut self.games {
            game.participants.sort_by_key(|p| p.participant_id);
        }
    }

    pub fn revision(&self) -> Result<String, StoreError> {
        let mut snapshot = self.clone();
        snapshot.canonicalize();
        let bytes =
            serde_json::to_vec(&snapshot).map_err(|error| StoreError::Other(error.to_string()))?;
        Ok(format!("{:x}", Sha256::digest(bytes)))
    }
}

#[derive(Debug, Clone)]
pub struct CompetitionCorrection {
    pub expected_revision: String,
    pub next: CompetitionSnapshot,
    pub match_id: Uuid,
    pub expected_workflow_revision: i64,
    pub workflow: MatchWorkflow,
}

impl CompetitionCorrection {
    pub fn invalidates(&self, previous: &Match) -> bool {
        previous.id != self.match_id
            && self
                .next
                .matches
                .iter()
                .find(|m| m.id == previous.id)
                .is_none_or(|m| m.updated_at != previous.updated_at)
    }
    pub fn invalidate_workflow(&self, mut workflow: MatchWorkflow) -> MatchWorkflow {
        workflow.revision += 1;
        for report in &mut workflow.submissions {
            report.status = SubmissionStatus::Rejected;
        }
        if let Some(audit) = self.workflow.history.last() {
            for dispute in &mut workflow.disputes {
                if dispute.decision.is_none() {
                    dispute.decision = Some(DisputeDecision {
                        actor_id: audit.actor_id,
                        reason: audit.reason.clone().unwrap_or_default(),
                        accepted: false,
                        decided_at: audit.created_at.clone(),
                    });
                }
            }
            workflow.history.push(MatchAuditEntry { id: Uuid::new_v4(), actor_id: audit.actor_id, action: "match.corrected".into(), reason: audit.reason.clone(), created_at: audit.created_at.clone(), before: serde_json::json!({}), after: serde_json::json!({"source_match_id":self.match_id,"source_operation_id":audit.id}) });
        }
        workflow
    }
}
