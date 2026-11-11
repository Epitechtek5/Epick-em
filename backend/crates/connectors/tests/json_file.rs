//! Le connecteur « fichiers JSON » du tutoriel (`docs/connecteurs.md`) branché sur la
//! synchronisation commune : import, puis résultat corrigé dans le fichier.

use connectors::ConnectorRegistry;
use connectors::json_file::JsonFileConnector;
use connectors::sync::{
    ChangeKind, MemorySyncStore, NewSource, SyncPolicy, SyncService, SyncStore,
};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;

#[tokio::test]
async fn a_result_corrected_in_the_file_produces_one_change_event() {
    let dir = std::env::temp_dir().join(format!("epickem-json-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("ligue-locale.json");
    std::fs::copy(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/jsonfile/ligue-locale.json"),
        &file,
    )
    .unwrap();
    let registry = ConnectorRegistry::new().register(Arc::new(JsonFileConnector::new(&dir)));
    let store = Arc::new(MemorySyncStore::new());
    let sync = SyncService::new(registry, store.clone(), SyncPolicy::default());

    let (_, reference) = sync
        .registry()
        .resolve_url("jsonfile://ligue-locale")
        .await
        .unwrap();
    let (source, created) = sync
        .import(
            NewSource {
                reference,
                event_ids: vec!["principal".into()],
                tournament_id: None,
            },
            1_000,
        )
        .await
        .unwrap();
    assert!(created);
    assert!(source.capabilities.matches && source.capabilities.standings);
    assert!(!source.capabilities.incremental_sync);
    let initial = store.pending_changes(100).await.unwrap().len();

    // Rejouer sans changement : aucun événement.
    sync.sync_one(source.id, 2_000).await.unwrap();
    assert_eq!(store.pending_changes(100).await.unwrap().len(), initial);

    // Score corrigé dans le fichier : 3-1 devient 3-2.
    let mut json: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    json["events"][0]["matches"][0]["slots"][1]["score"] = 2.into();
    std::fs::write(&file, serde_json::to_vec(&json).unwrap()).unwrap();
    let report = sync.sync_one(source.id, 3_000).await.unwrap();
    assert!(report.ok);
    let pending = store.pending_changes(100).await.unwrap();
    let new: Vec<_> = pending.iter().skip(initial).collect();
    assert_eq!(new.len(), 1, "{new:?}");
    assert_eq!(new[0].2.kind, ChangeKind::ResultCorrected);
    assert_eq!(new[0].2.match_id.as_deref(), Some("m1"));

    std::fs::remove_dir_all(&dir).unwrap();
}
