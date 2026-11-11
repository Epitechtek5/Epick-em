//! Connecteur start.gg contre un double GraphQL hors ligne, sur des réponses enregistrées
//! (`tests/fixtures/startgg`) : aucun jeton ni réseau nécessaire.

use async_trait::async_trait;
use connectors::model::{
    BracketFormat, Capabilities, CompetitionState, ExternalDelta, MatchState, SyncCursor,
};
use connectors::startgg::queries::operation;
use connectors::startgg::{GraphqlTransport, StartGgConnector};
use connectors::sync::{ChangeKind, apply_delta};
use connectors::{
    ConnectorError, ConnectorRegistry, ResiliencePolicy, ResilientConnector, TournamentConnector,
};
use serde_json::Value;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/startgg")
        .join(format!("{name}.json"));
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap()
}

/// Double de l'API : répond d'après le nom d'opération et la page ; les erreurs prévues
/// passent avant.
#[derive(Default)]
struct FakeApi {
    errors: Mutex<VecDeque<(String, ConnectorError)>>,
    calls: Mutex<Vec<(String, Value)>>,
}

impl FakeApi {
    fn fail_next(&self, operation: &str, error: ConnectorError) {
        self.errors
            .lock()
            .unwrap()
            .push_back((operation.to_string(), error));
    }

    fn calls(&self, operation: &str) -> Vec<Value> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(op, _)| op == operation)
            .map(|(_, v)| v.clone())
            .collect()
    }

    fn total_calls(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

#[async_trait]
impl GraphqlTransport for FakeApi {
    async fn query(&self, query: &str, variables: Value) -> Result<Value, ConnectorError> {
        let op = operation(query).to_string();
        self.calls
            .lock()
            .unwrap()
            .push((op.clone(), variables.clone()));
        {
            let mut errors = self.errors.lock().unwrap();
            if errors.front().is_some_and(|(o, _)| o == &op) {
                return Err(errors.pop_front().unwrap().1);
            }
        }
        let page = variables["page"].as_u64().unwrap_or(1);
        let event = variables["eventId"].as_str().unwrap_or_default();
        Ok(match op.as_str() {
            "Search" => fixture("search"),
            "Tournament" if variables["slug"] == "epick-open-2026" => fixture("tournament"),
            "Tournament" => serde_json::json!({ "tournament": null }),
            "EventPhases" => fixture(&format!("phases_{event}")),
            "EventEntrants" => fixture(&format!("entrants_{event}_p{page}")),
            "EventSets" if !variables["updatedAfter"].is_null() => {
                fixture(&format!("sets_{event}_updated"))
            }
            "EventSets" => fixture(&format!("sets_{event}_p{page}")),
            "EventStandings" => fixture(&format!("standings_{event}")),
            other => panic!("opération inattendue : {other}"),
        })
    }
}

fn connector() -> (StartGgConnector, Arc<FakeApi>) {
    let api = Arc::new(FakeApi::default());
    (StartGgConnector::new(api.clone()), api)
}

#[tokio::test]
async fn urls_are_resolved_without_ever_calling_them() {
    let (startgg, api) = connector();
    let reference = startgg
        .resolve_url("https://www.start.gg/tournament/epick-open-2026/event/ultimate-singles")
        .await
        .unwrap();
    assert_eq!(reference.provider, "startgg");
    assert_eq!(reference.external_id, "500");
    assert_eq!(reference.slug.as_deref(), Some("epick-open-2026"));
    assert_eq!(
        reference.url.as_deref(),
        Some("https://www.start.gg/tournament/epick-open-2026")
    );
    assert_eq!(api.calls("Tournament")[0]["slug"], "epick-open-2026");

    let before = api.total_calls();
    for url in [
        "http://169.254.169.254/latest/meta-data",
        "https://evil.example/tournament/epick-open-2026",
        "file:///etc/passwd",
    ] {
        assert!(matches!(
            startgg.resolve_url(url).await,
            Err(ConnectorError::InvalidUrl(_))
        ));
    }
    assert_eq!(
        api.total_calls(),
        before,
        "aucune requête pour une URL refusée"
    );
    assert_eq!(
        startgg
            .resolve_url("https://start.gg/tournament/inconnu")
            .await
            .unwrap_err(),
        ConnectorError::NotFound
    );
}

#[tokio::test]
async fn search_and_event_listing() {
    let (startgg, api) = connector();
    let found = startgg.search("  Epick Open ").await.unwrap();
    assert_eq!(found.len(), 2, "le nœud sans identifiant est ignoré");
    assert_eq!(
        found[1].url.as_deref(),
        Some("https://www.start.gg/tournament/epick-open-2025")
    );
    assert_eq!(api.calls("Search")[0]["name"], "Epick Open");
    assert!(startgg.search("x").await.unwrap().is_empty());

    let events = startgg.list_events(&found[0]).await.unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].external_id, "900");
    assert_eq!(
        events[0].game.as_deref(),
        Some("Super Smash Bros. Ultimate")
    );
    assert_eq!(events[0].state, CompetitionState::Active);
    assert_eq!(events[0].entrant_count, Some(4));
}

#[tokio::test]
async fn a_full_snapshot_maps_every_available_field() {
    let (startgg, api) = connector();
    let reference = startgg.resolve_url("epick-open-2026").await.unwrap();
    let snapshot = startgg.fetch(&reference, &["900".into()]).await.unwrap();
    assert_eq!(snapshot.state, CompetitionState::Active);
    assert_eq!(snapshot.events.len(), 1, "seule l'épreuve choisie");
    let event = &snapshot.events[0];

    // Phases et groupes, format hérité de la phase si le groupe n'en donne pas.
    assert_eq!(event.phases.len(), 2);
    assert_eq!(event.phases[0].format, Some(BracketFormat::RoundRobin));
    assert_eq!(
        event.phases[1].groups[0].format,
        Some(BracketFormat::DoubleElimination)
    );
    assert_eq!(event.phases[0].groups[0].label.as_deref(), Some("A1"));

    // Inscrits sur deux pages, seeds et joueurs ; seed absent : absent.
    assert_eq!(api.calls("EventEntrants").len(), 2);
    assert_eq!(event.entrants.len(), 4);
    assert_eq!(event.entrants[0].seed, Some(1));
    assert_eq!(
        event.entrants[0].players[0].prefix.as_deref(),
        Some("Team A")
    );
    assert_eq!(event.entrants[2].seed, None);
    assert!(event.entrants[3].players.is_empty());

    // Sets sur deux pages.
    assert_eq!(api.calls("EventSets").len(), 2);
    assert_eq!(event.matches.len(), 4);
    let first = &event.matches[0];
    assert_eq!(first.state, MatchState::Completed);
    assert_eq!(first.winner_entrant_id.as_deref(), Some("7001"));
    assert_eq!(first.games.len(), 3);
    assert_eq!(first.games[0].stage.as_deref(), Some("Battlefield"));
    assert_eq!(
        first.games[0].selections[1].character.as_deref(),
        Some("Link")
    );
    assert_eq!(first.games[2].stage, None);
    assert_eq!(first.games[2].selections[1].character, None);
    assert_eq!(
        first.url.as_deref(),
        Some("https://www.start.gg/tournament/epick-open-2026/event/ultimate-singles/set/3001")
    );
    let dq = &event.matches[1];
    assert!(dq.forfeit);
    assert_eq!(dq.slots[1].score, None);
    assert!(dq.games.is_empty());
    assert_eq!(event.matches[2].state, MatchState::InProgress);
    let preview = &event.matches[3];
    assert_eq!(preview.external_id, "preview_2001_4");
    assert_eq!(preview.round, Some(-1));
    assert_eq!(preview.slots[1].entrant_id, None);

    // Classement : la ligne sans place est ignorée.
    assert_eq!(event.standings.len(), 3);
    assert_eq!(event.standings[0].entrant_id, "7001");

    let observed = Capabilities::observed(&snapshot, startgg.capabilities());
    assert!(observed.characters && observed.stages && observed.seeds && observed.standings);
    assert!(observed.incremental_sync);

    assert_eq!(
        startgg
            .fetch(&reference, &["999".into()])
            .await
            .unwrap_err(),
        ConnectorError::NotFound
    );
}

#[tokio::test]
async fn too_complex_pages_are_split_in_half() {
    let api = Arc::new(FakeApi::default());
    let startgg = StartGgConnector::new(api.clone()).with_sets_per_page(8);
    let reference = startgg.resolve_url("epick-open-2026").await.unwrap();
    api.fail_next("EventSets", ConnectorError::TooComplex);
    startgg.fetch(&reference, &["900".into()]).await.unwrap();
    let pages: Vec<(u64, u64)> = api
        .calls("EventSets")
        .iter()
        .map(|v| (v["page"].as_u64().unwrap(), v["perPage"].as_u64().unwrap()))
        .collect();
    assert_eq!(pages[0], (1, 8));
    assert_eq!(
        pages[1],
        (1, 4),
        "même position, pages deux fois plus petites"
    );
}

#[tokio::test]
async fn incremental_updates_only_read_changed_sets() {
    let (startgg, api) = connector();
    let reference = startgg.resolve_url("epick-open-2026").await.unwrap();
    let events = ["900".to_string()];
    let snapshot = startgg.fetch(&reference, &events).await.unwrap();

    let delta = startgg
        .fetch_updates(
            &reference,
            &events,
            SyncCursor {
                updated_after: Some(1_767_228_500),
            },
        )
        .await
        .unwrap();
    let updated_calls = api.calls("EventSets");
    assert_eq!(updated_calls.last().unwrap()["updatedAfter"], 1_767_228_440);
    let ExternalDelta::Partial {
        matches, standings, ..
    } = &delta
    else {
        panic!("incrémental attendu");
    };
    assert_eq!(matches.len(), 2);
    assert_eq!(standings.len(), 1);

    // Fusion : une correction et un match terminé, le reste intact.
    let (merged, changes) = apply_delta(Some(&snapshot), delta).unwrap();
    assert_eq!(merged.events[0].matches.len(), 4);
    let kinds: Vec<_> = changes.iter().map(|c| c.kind).collect();
    assert_eq!(
        kinds,
        vec![ChangeKind::ResultCorrected, ChangeKind::MatchCompleted]
    );
    assert_eq!(changes[0].match_id.as_deref(), Some("3001"));

    // Sans curseur : instantané complet.
    assert!(matches!(
        startgg
            .fetch_updates(&reference, &events, SyncCursor::default())
            .await
            .unwrap(),
        ExternalDelta::Full { .. }
    ));
}

#[tokio::test(start_paused = true)]
async fn throttling_and_outages_through_the_resilience_layer() {
    let (startgg, api) = connector();
    let resilient = ResilientConnector::new(
        Arc::new(startgg),
        ResiliencePolicy {
            failure_threshold: 2,
            max_retries: 2,
            ..ResiliencePolicy::default()
        },
        None,
    );
    // 429 avec Retry-After, puis succès.
    api.fail_next(
        "Tournament",
        ConnectorError::RateLimited {
            retry_after: Some(Duration::from_secs(3)),
        },
    );
    let started = tokio::time::Instant::now();
    let reference = resilient.resolve_url("epick-open-2026").await.unwrap();
    assert!(started.elapsed() >= Duration::from_secs(3));

    // Panne prolongée : reprises épuisées, puis disjoncteur ouvert, plus aucun appel.
    for _ in 0..2 {
        api.fail_next("Tournament", ConnectorError::Timeout);
    }
    assert_eq!(
        resilient
            .fetch(&reference, &["900".into()])
            .await
            .unwrap_err(),
        ConnectorError::CircuitOpen
    );
    let calls = api.total_calls();
    assert_eq!(
        resilient
            .fetch(&reference, &["900".into()])
            .await
            .unwrap_err(),
        ConnectorError::CircuitOpen
    );
    assert_eq!(api.total_calls(), calls);
    // Reprise automatique après le délai.
    tokio::time::advance(Duration::from_secs(61)).await;
    assert!(resilient.fetch(&reference, &["900".into()]).await.is_ok());
}

#[tokio::test]
async fn the_registry_routes_urls_to_the_right_connector() {
    let (startgg, _) = connector();
    let dir = std::env::temp_dir().join(format!("epickem-json-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::copy(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/jsonfile/ligue-locale.json"),
        dir.join("ligue-locale.json"),
    )
    .unwrap();
    let registry = ConnectorRegistry::new()
        .register(Arc::new(startgg))
        .register(Arc::new(connectors::json_file::JsonFileConnector::new(
            &dir,
        )));

    let (connector, reference) = registry
        .resolve_url("https://start.gg/tournament/epick-open-2026")
        .await
        .unwrap();
    assert_eq!(connector.id(), "startgg");
    assert_eq!(reference.external_id, "500");

    let (connector, reference) = registry
        .resolve_url("jsonfile://ligue-locale")
        .await
        .unwrap();
    assert_eq!(connector.id(), "jsonfile");
    let events = connector.list_events(&reference).await.unwrap();
    let snapshot = connector
        .fetch(&reference, &[events[0].external_id.clone()])
        .await
        .unwrap();
    assert_eq!(snapshot.events[0].matches.len(), 1);
    // Sans incrémental : la synchronisation reçoit un instantané complet.
    assert!(matches!(
        connector
            .fetch_updates(
                &reference,
                &[events[0].external_id.clone()],
                SyncCursor {
                    updated_after: Some(1)
                }
            )
            .await
            .unwrap(),
        ExternalDelta::Full { .. }
    ));
    assert_eq!(connector.search("ligue").await.unwrap().len(), 1);

    for url in [
        "jsonfile://../etc/passwd",
        "https://example.com/x",
        "jsonfile://inconnu",
    ] {
        assert!(registry.resolve_url(url).await.is_err(), "{url}");
    }
    std::fs::remove_dir_all(&dir).unwrap();
}
