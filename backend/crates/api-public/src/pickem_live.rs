//! Pick'em invalidations shared by the periodic worker and event consumers.
use crate::resolution::ResolutionReport;
use domain::events::{LiveMessage, live, topics};
use infra::LiveBus;
use serde_json::json;
use std::{collections::HashMap, sync::OnceLock};
use tokio::sync::Mutex;
use uuid::Uuid;

type Locks = HashMap<Uuid, Vec<Uuid>>;
static LOCKS: OnceLock<Mutex<Locks>> = OnceLock::new();

/// A fresh worker refreshes each tournament once; subsequent passes notify only transitions.
/// Pub/Sub is ephemeral: reconnecting clients must fetch authoritative API state.
pub async fn announce(bus: &dyn LiveBus, report: &ResolutionReport) {
    let mut states = LOCKS.get_or_init(Mutex::default).lock().await;
    let data = json!({"tournament_id": report.tournament_id});
    if states.get(&report.tournament_id) != Some(&report.locked) {
        let message = LiveMessage::new(
            topics::tournament(report.tournament_id),
            live::PREDICTIONS_UPDATED,
            data.clone(),
        );
        if let Err(err) = bus.broadcast(&message).await {
            eprintln!("pickem lock notification failed: {err}");
        } else {
            // Bound worker memory; clearing causes harmless conservative invalidations.
            if states.len() >= 10_000 {
                states.clear();
            }
            states.insert(report.tournament_id, report.locked.clone());
        }
    }
    drop(states);
    if report.changed > 0 {
        for topic in [
            topics::tournament(report.tournament_id),
            topics::LEADERBOARD.into(),
        ] {
            if let Err(err) = bus
                .broadcast(&LiveMessage::new(
                    topic,
                    live::LEADERBOARD_UPDATED,
                    data.clone(),
                ))
                .await
            {
                eprintln!("pickem leaderboard notification failed: {err}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn a_clock_only_lock_change_is_announced_once() {
        let bus = infra::MemoryLive::new();
        let mut receiver = bus.subscribe();
        let mut report = ResolutionReport {
            tournament_id: Uuid::new_v4(),
            predictions: 1,
            answers: 0,
            settled: false,
            changed: 0,
            locked: vec![],
        };
        announce(&bus, &report).await;
        receiver.recv().await.unwrap();
        announce(&bus, &report).await;
        assert!(receiver.try_recv().is_err());
        report.locked.push(Uuid::new_v4());
        announce(&bus, &report).await;
        assert_eq!(
            receiver.recv().await.unwrap().event,
            live::PREDICTIONS_UPDATED
        );
        announce(&bus, &report).await;
        assert!(receiver.try_recv().is_err());
    }
}
