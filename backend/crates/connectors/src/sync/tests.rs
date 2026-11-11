use super::*;
use crate::model::{ExternalEvent, ExternalEventRef, ExternalSlot, ExternalStanding};
use std::collections::VecDeque;
use std::sync::Mutex;

fn reference() -> ExternalTournamentRef {
    ExternalTournamentRef {
        provider: "fake".into(),
        external_id: "t1".into(),
        slug: Some("t1".into()),
        name: "Tournoi".into(),
        url: Some("https://example.test/t1".into()),
        starts_at: Some(1_700_000_000),
        ends_at: None,
    }
}

fn set(
    id: &str,
    state: MatchState,
    winner: Option<&str>,
    scores: [Option<i32>; 2],
) -> ExternalMatch {
    ExternalMatch {
        external_id: id.into(),
        phase_id: None,
        group_id: None,
        round: Some(1),
        round_label: None,
        state,
        slots: vec![
            ExternalSlot {
                entrant_id: Some("a".into()),
                score: scores[0],
            },
            ExternalSlot {
                entrant_id: Some("b".into()),
                score: scores[1],
            },
        ],
        winner_entrant_id: winner.map(str::to_string),
        forfeit: false,
        games: Vec::new(),
        started_at: None,
        completed_at: None,
        updated_at: None,
        url: None,
    }
}

fn tournament(state: CompetitionState, matches: Vec<ExternalMatch>) -> ExternalTournament {
    ExternalTournament {
        reference: reference(),
        state,
        events: vec![ExternalEvent {
            reference: ExternalEventRef {
                external_id: "e1".into(),
                name: "Singles".into(),
                game: None,
                url: None,
                starts_at: None,
                state,
                entrant_count: Some(2),
            },
            phases: Vec::new(),
            entrants: Vec::new(),
            matches,
            standings: Vec::new(),
        }],
    }
}

/// Source dont chaque appel à `fetch_updates` consomme la réponse suivante.
#[derive(Default)]
struct Fake {
    responses: Mutex<VecDeque<Result<ExternalDelta, ConnectorError>>>,
    cursors: Mutex<Vec<SyncCursor>>,
}

impl Fake {
    fn push(&self, response: Result<ExternalDelta, ConnectorError>) {
        self.responses.lock().unwrap().push_back(response);
    }
}

#[async_trait]
impl TournamentConnector for Fake {
    fn id(&self) -> &'static str {
        "fake"
    }
    fn display_name(&self) -> &'static str {
        "Fake"
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            incremental_sync: true,
            matches: true,
            ..Capabilities::default()
        }
    }
    async fn search(&self, _: &str) -> Result<Vec<ExternalTournamentRef>, ConnectorError> {
        Ok(Vec::new())
    }
    async fn resolve_url(&self, _: &str) -> Result<ExternalTournamentRef, ConnectorError> {
        Ok(reference())
    }
    async fn list_events(
        &self,
        _: &ExternalTournamentRef,
    ) -> Result<Vec<crate::model::ExternalEventRef>, ConnectorError> {
        Ok(Vec::new())
    }
    async fn fetch(
        &self,
        _: &ExternalTournamentRef,
        _: &[String],
    ) -> Result<ExternalTournament, ConnectorError> {
        unreachable!("la synchronisation passe par fetch_updates")
    }
    async fn fetch_updates(
        &self,
        _: &ExternalTournamentRef,
        _: &[String],
        cursor: SyncCursor,
    ) -> Result<ExternalDelta, ConnectorError> {
        self.cursors.lock().unwrap().push(cursor);
        self.responses
            .lock()
            .unwrap()
            .pop_front()
            .expect("réponse prévue")
    }
}

fn service() -> (SyncService, Arc<Fake>, Arc<MemorySyncStore>) {
    let fake = Arc::new(Fake::default());
    let store = Arc::new(MemorySyncStore::new());
    let service = SyncService::new(
        ConnectorRegistry::new().register(fake.clone()),
        store.clone(),
        SyncPolicy::default(),
    );
    (service, fake, store)
}

fn new_source() -> NewSource {
    NewSource {
        reference: reference(),
        event_ids: vec!["e1".into()],
        tournament_id: None,
    }
}

const T0: i64 = 1_700_000_000;

#[tokio::test]
async fn import_is_idempotent_and_takes_a_full_snapshot() {
    let (service, fake, store) = service();
    fake.push(Ok(ExternalDelta::Full {
        tournament: tournament(
            CompetitionState::Active,
            vec![set(
                "s1",
                MatchState::Completed,
                Some("a"),
                [Some(2), Some(0)],
            )],
        ),
    }));
    let (record, created) = service.import(new_source(), T0).await.unwrap();
    assert!(created);
    assert_eq!(fake.cursors.lock().unwrap()[0], SyncCursor::default());
    assert!(record.snapshot.is_some());
    assert_eq!(record.cursor.updated_after, Some(T0));
    assert_eq!(record.last_success_at, Some(T0));
    assert!(record.capabilities.matches && !record.capabilities.standings);
    assert_eq!(record.next_sync_at, T0 + SyncPolicy::default().active_every);
    // Le premier instantané d'un match déjà terminé est un résultat à traiter.
    let pending = store.pending_changes(10).await.unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].2.kind, ChangeKind::MatchCompleted);

    // Second import du même tournoi : rien de nouveau, aucun appel à la source.
    let (again, created) = service.import(new_source(), T0 + 5).await.unwrap();
    assert!(!created);
    assert_eq!(again.id, record.id);
    assert_eq!(fake.cursors.lock().unwrap().len(), 1);
    assert_eq!(store.list().await.unwrap().len(), 1);
}

#[tokio::test]
async fn partial_updates_are_merged_and_results_changes_detected() {
    let (service, fake, store) = service();
    fake.push(Ok(ExternalDelta::Full {
        tournament: tournament(
            CompetitionState::Active,
            vec![
                set("s1", MatchState::Completed, Some("a"), [Some(2), Some(1)]),
                set("s2", MatchState::InProgress, None, [Some(1), Some(0)]),
                set("s3", MatchState::Completed, Some("b"), [Some(0), Some(2)]),
            ],
        ),
    }));
    let (record, _) = service.import(new_source(), T0).await.unwrap();
    let first: Vec<i64> = store
        .pending_changes(10)
        .await
        .unwrap()
        .iter()
        .map(|c| c.0)
        .collect();
    store.mark_processed(&first).await.unwrap();

    let partial = ExternalDelta::Partial {
        state: CompetitionState::Active,
        matches: vec![
            // Correction : le vainqueur change.
            (
                "e1".into(),
                set("s1", MatchState::Completed, Some("b"), [Some(1), Some(2)]),
            ),
            // Fin d'un match en cours.
            (
                "e1".into(),
                set("s2", MatchState::Completed, Some("a"), [Some(2), Some(0)]),
            ),
            // Match rouvert.
            (
                "e1".into(),
                set("s3", MatchState::Pending, None, [None, None]),
            ),
            // Nouveau match pas encore joué : pas un résultat.
            (
                "e1".into(),
                set("s4", MatchState::Pending, None, [None, None]),
            ),
        ],
        standings: vec![(
            "e1".into(),
            vec![ExternalStanding {
                entrant_id: "a".into(),
                placement: 1,
            }],
        )],
    };
    fake.push(Ok(partial.clone()));
    let report = service.sync_one(record.id, T0 + 200).await.unwrap();
    assert!(report.ok, "{report:?}");
    assert_eq!(fake.cursors.lock().unwrap()[1].updated_after, Some(T0));
    let kinds: Vec<ChangeKind> = store
        .pending_changes(10)
        .await
        .unwrap()
        .into_iter()
        .map(|c| c.2.kind)
        .collect();
    assert_eq!(
        kinds,
        vec![
            ChangeKind::ResultCorrected,
            ChangeKind::MatchCompleted,
            ChangeKind::MatchReopened,
            ChangeKind::StandingsChanged,
        ]
    );
    let record = store.find(record.id).await.unwrap().unwrap();
    let matches = &record.snapshot.as_ref().unwrap().events[0].matches;
    assert_eq!(matches.len(), 4);
    assert_eq!(matches[0].winner_entrant_id.as_deref(), Some("b"));

    // Rejouer la même mise à jour : idempotent, aucun nouvel événement.
    let before = store.pending_changes(100).await.unwrap().len();
    fake.push(Ok(partial));
    assert!(service.sync_one(record.id, T0 + 400).await.unwrap().ok);
    assert_eq!(store.pending_changes(100).await.unwrap().len(), before);
}

#[tokio::test]
async fn outages_keep_the_last_snapshot_and_back_off_until_recovery() {
    let (service, fake, store) = service();
    let snapshot = tournament(CompetitionState::Active, Vec::new());
    fake.push(Ok(ExternalDelta::Full {
        tournament: snapshot.clone(),
    }));
    let (record, _) = service.import(new_source(), T0).await.unwrap();

    for (attempt, error) in [ConnectorError::Timeout, ConnectorError::CircuitOpen]
        .into_iter()
        .enumerate()
    {
        fake.push(Err(error));
        let now = T0 + 1000 * (attempt as i64 + 1);
        let report = service.sync_one(record.id, now).await.unwrap();
        assert!(!report.ok);
        let failed = store.find(record.id).await.unwrap().unwrap();
        assert_eq!(
            failed.snapshot.as_ref(),
            Some(&snapshot),
            "instantané conservé"
        );
        assert!(failed.is_stale());
        assert_eq!(failed.last_success_at, Some(T0));
        assert_eq!(failed.last_attempt_at, Some(now));
        assert_eq!(failed.consecutive_failures, attempt as u32 + 1);
        // 60 s puis 120 s.
        assert_eq!(failed.next_sync_at, now + 60 * (1 << attempt));
    }

    // Reprise : le planificateur la retrouve due, et tout redevient frais.
    fake.push(Ok(ExternalDelta::Partial {
        state: CompetitionState::Completed,
        matches: Vec::new(),
        standings: Vec::new(),
    }));
    let reports = service.run_due(T0 + 10_000, 10).await.unwrap();
    assert_eq!(reports.len(), 1);
    assert!(reports[0].ok);
    let recovered = store.find(record.id).await.unwrap().unwrap();
    assert!(!recovered.is_stale());
    assert_eq!(recovered.consecutive_failures, 0);
    assert_eq!(
        recovered.snapshot.unwrap().state,
        CompetitionState::Completed
    );
    let kinds: Vec<_> = store
        .pending_changes(10)
        .await
        .unwrap()
        .into_iter()
        .map(|c| c.2.kind)
        .collect();
    assert_eq!(kinds, vec![ChangeKind::TournamentStateChanged]);
}

#[tokio::test]
async fn a_source_is_never_synchronised_twice_at_once() {
    let (service, fake, store) = service();
    fake.push(Ok(ExternalDelta::Full {
        tournament: tournament(CompetitionState::Active, Vec::new()),
    }));
    let (record, _) = service.import(new_source(), T0).await.unwrap();
    let due = T0 + 10_000;
    // Un autre processus a pris le bail.
    assert!(store.claim(record.id, due, 600).await.unwrap().is_some());
    assert!(matches!(
        service.sync_one(record.id, due).await,
        Err(SyncError::Busy)
    ));
    assert!(service.run_due(due, 10).await.unwrap().is_empty());
    // Bail expiré (processus mort) : la source est reprise.
    fake.push(Ok(ExternalDelta::Full {
        tournament: tournament(CompetitionState::Active, Vec::new()),
    }));
    assert_eq!(service.run_due(due + 601, 10).await.unwrap().len(), 1);
}

#[tokio::test]
async fn a_failed_first_import_stays_registered_for_retry() {
    let (service, fake, store) = service();
    fake.push(Err(ConnectorError::Unavailable("panne".into())));
    assert!(service.import(new_source(), T0).await.is_err());
    let record = &store.list().await.unwrap()[0];
    assert!(record.snapshot.is_none());
    assert!(record.last_error.is_some());
    // Pas d'instantané : la reprise demande un instantané complet, pas un incrémental.
    fake.push(Ok(ExternalDelta::Full {
        tournament: tournament(CompetitionState::Created, Vec::new()),
    }));
    assert!(service.run_due(T0 + 61, 10).await.unwrap()[0].ok);
    assert_eq!(fake.cursors.lock().unwrap()[1], SyncCursor::default());
}

#[tokio::test]
async fn unknown_providers_and_conflicting_links_are_refused() {
    let (service, _, _) = service();
    let mut other = new_source();
    other.reference.provider = "inconnu".into();
    assert!(matches!(
        service.import(other, T0).await,
        Err(SyncError::UnknownProvider(_))
    ));

    let store = MemorySyncStore::new();
    let local = Uuid::new_v4();
    let linked = NewSource {
        tournament_id: Some(local),
        ..new_source()
    };
    store.register(linked.clone(), T0).await.unwrap();
    // Même tournoi local pour une autre source : refusé.
    let mut second = linked.clone();
    second.reference.external_id = "t2".into();
    assert!(matches!(
        store.register(second, T0).await,
        Err(StoreError::Conflict)
    ));
    // Même source pour un autre tournoi local : refusé.
    let mut third = linked;
    third.tournament_id = Some(Uuid::new_v4());
    assert!(matches!(
        store.register(third, T0).await,
        Err(StoreError::Conflict)
    ));
}

#[test]
fn backoff_is_capped() {
    let policy = SyncPolicy::default();
    assert_eq!(policy.next_after_failure(0, 0), 60);
    assert_eq!(policy.next_after_failure(3, 0), 480);
    assert_eq!(policy.next_after_failure(30, 0), 3600);
}
