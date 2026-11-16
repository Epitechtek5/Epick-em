//! Contrat commun des [`SyncStore`] : le même parcours sur le store en mémoire et sur Redis
//! (lien source ↔ tournoi en PostgreSQL).
//!
//! Le test Redis est ignoré par défaut ; il lui faut Redis et une base migrée par Liquibase :
//! `DATABASE_URL=postgres://… REDIS_URL=redis://… cargo test -p connectors --test sync_store
//! -- --ignored`.

use connectors::model::{
    Capabilities, CompetitionState, ExternalTournament, ExternalTournamentRef, SyncCursor,
};
use connectors::sync::{
    ChangeEvent, ChangeKind, MemorySyncStore, NewSource, RedisSyncStore, StoreError, Success,
    SyncStore,
};
use infra::{CachedDb, MemoryCache, RedisCache};
use redis::AsyncCommands;
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;

fn reference(external_id: &str) -> ExternalTournamentRef {
    ExternalTournamentRef {
        provider: "fake".into(),
        external_id: external_id.into(),
        slug: Some(external_id.into()),
        name: format!("Tournoi {external_id}"),
        url: Some(format!("https://example.test/{external_id}")),
        starts_at: Some(1_700_000_000),
        ends_at: None,
    }
}

fn snapshot(external_id: &str) -> ExternalTournament {
    ExternalTournament {
        reference: reference(external_id),
        state: CompetitionState::Active,
        events: Vec::new(),
    }
}

fn change(match_id: &str) -> ChangeEvent {
    ChangeEvent {
        kind: ChangeKind::MatchCompleted,
        event_id: Some("e1".into()),
        match_id: Some(match_id.into()),
        payload: json!({ "winner": "a" }),
    }
}

/// `tag` rend les identifiants externes uniques : le test PostgreSQL peut être rejoué sur la
/// même base. `tournament` doit exister dans `tournaments` pour PostgreSQL (clé étrangère).
async fn contract(store: &dyn SyncStore, tag: &str, tournament: Option<Uuid>) {
    let now = 1_800_000_000;
    let a = format!("a-{tag}");
    let b = format!("b-{tag}");

    // Identité : (fournisseur, identifiant externe) unique, enregistrement idempotent.
    let (first, created) = store
        .register(
            NewSource {
                reference: reference(&a),
                event_ids: vec!["e1".into(), "e2".into()],
                tournament_id: tournament,
            },
            now,
        )
        .await
        .unwrap();
    assert!(created);
    assert_eq!(first.event_ids, ["e1", "e2"]);
    assert_eq!(first.tournament_id, tournament);
    assert_eq!(first.next_sync_at, now);
    assert!(first.snapshot.is_none());
    let (again, created) = store
        .register(
            NewSource {
                reference: reference(&a),
                event_ids: vec!["e1".into()],
                tournament_id: None,
            },
            now,
        )
        .await
        .unwrap();
    assert!(!created);
    assert_eq!(again.id, first.id);
    if let Some(linked) = tournament {
        // Le tournoi local est déjà lié à `a`.
        assert!(matches!(
            store
                .register(
                    NewSource {
                        reference: reference(&b),
                        event_ids: Vec::new(),
                        tournament_id: tournament,
                    },
                    now,
                )
                .await,
            Err(StoreError::Conflict)
        ));
        assert_eq!(
            store
                .find_by_tournament(linked)
                .await
                .unwrap()
                .map(|s| s.id),
            Some(first.id)
        );
    }
    let (second, _) = store
        .register(
            NewSource {
                reference: reference(&b),
                event_ids: vec!["x".into()],
                tournament_id: None,
            },
            now + 100,
        )
        .await
        .unwrap();

    // Bail : une source réclamée ne l'est pas une seconde fois avant expiration.
    let due = store.claim_due(now, 50, 600).await.unwrap();
    assert!(due.iter().any(|s| s.id == first.id));
    assert!(!due.iter().any(|s| s.id == second.id), "pas encore due");
    assert!(store.claim(first.id, now + 1, 600).await.unwrap().is_none());
    assert!(
        !store
            .claim_due(now + 1, 50, 600)
            .await
            .unwrap()
            .iter()
            .any(|s| s.id == first.id)
    );

    // Succès : instantané, curseur, capacités, échéance et événements dans la même écriture.
    store
        .save_success(
            first.id,
            now + 600,
            Success {
                snapshot: snapshot(&a),
                capabilities: Capabilities {
                    matches: true,
                    ..Capabilities::default()
                },
                cursor: SyncCursor {
                    updated_after: Some(now),
                },
                now,
                next_sync_at: now + 120,
            },
            &[change("m1"), change("m2")],
        )
        .await
        .unwrap();
    let saved = store.find(first.id).await.unwrap().unwrap();
    assert_eq!(saved.snapshot, Some(snapshot(&a)));
    assert_eq!(saved.cursor.updated_after, Some(now));
    assert!(saved.capabilities.matches);
    assert_eq!(saved.last_success_at, Some(now));
    assert_eq!(saved.next_sync_at, now + 120);
    assert!(!saved.is_stale());
    // Le succès relâche le bail.
    assert!(store.claim(first.id, now + 2, 600).await.unwrap().is_some());

    // Une synchronisation qui n'a plus le bail (expiré, repris) n'écrit rien.
    assert!(matches!(
        store
            .save_success(
                first.id,
                now + 600,
                Success {
                    snapshot: snapshot(&b),
                    capabilities: Capabilities::default(),
                    cursor: SyncCursor::default(),
                    now: now + 3,
                    next_sync_at: now + 3,
                },
                &[change("m3")],
            )
            .await,
        Err(StoreError::LeaseLost)
    ));
    assert!(matches!(
        store
            .save_failure(first.id, now + 600, "ancien", now + 3, now + 3)
            .await,
        Err(StoreError::LeaseLost)
    ));
    assert_eq!(
        store.find(first.id).await.unwrap().unwrap().snapshot,
        Some(snapshot(&a))
    );

    // Échec : l'instantané reste, l'erreur et le compteur sont enregistrés.
    store
        .save_failure(first.id, now + 602, "HTTP 503", now + 3, now + 63)
        .await
        .unwrap();
    let failed = store.find(first.id).await.unwrap().unwrap();
    assert_eq!(failed.snapshot, Some(snapshot(&a)));
    assert_eq!(failed.last_error.as_deref(), Some("HTTP 503"));
    assert_eq!(failed.consecutive_failures, 1);
    assert_eq!(failed.last_attempt_at, Some(now + 3));
    assert_eq!(failed.last_success_at, Some(now));
    assert_eq!(failed.next_sync_at, now + 63);
    assert!(failed.is_stale());

    // Boîte d'envoi : chaque événement est consommé une fois.
    let pending: Vec<_> = store
        .pending_changes(1000)
        .await
        .unwrap()
        .into_iter()
        .filter(|(_, source, _)| *source == first.id)
        .collect();
    assert_eq!(pending.len(), 2);
    assert_eq!(pending[0].2, change("m1"));
    assert!(pending[0].0 < pending[1].0, "ordre d'enregistrement");
    let ids: Vec<i64> = pending.iter().map(|(id, ..)| *id).collect();
    store.mark_processed(&ids).await.unwrap();
    assert!(
        !store
            .pending_changes(1000)
            .await
            .unwrap()
            .iter()
            .any(|(_, source, _)| *source == first.id)
    );

    let listed = store.list().await.unwrap();
    assert!(listed.iter().any(|s| s.id == first.id));
    assert!(listed.iter().any(|s| s.id == second.id));

    // Suppression : la source et ses événements disparaissent.
    assert!(store.delete(first.id).await.unwrap());
    assert!(!store.delete(first.id).await.unwrap());
    assert!(store.find(first.id).await.unwrap().is_none());
    assert!(store.delete(second.id).await.unwrap());
}

#[tokio::test]
async fn memory_store_honours_the_contract() {
    contract(&MemorySyncStore::new(), "mem", Some(Uuid::new_v4())).await;
}

#[tokio::test]
#[ignore = "nécessite Redis et PostgreSQL migré (REDIS_URL, DATABASE_URL)"]
async fn redis_store_honours_the_contract() {
    let pool = sqlx::PgPool::connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL"))
        .await
        .unwrap();
    let redis = RedisCache::connect(&std::env::var("REDIS_URL").expect("REDIS_URL"))
        .await
        .unwrap();
    let tag = Uuid::new_v4().simple().to_string();
    let prefix = format!("test-sync-{tag}");
    let store = |cache: Arc<dyn infra::Cache>| {
        RedisSyncStore::with_prefix(
            CachedDb::new(pool.clone(), cache),
            redis.connection(),
            &prefix,
        )
    };
    let shared: Arc<dyn infra::Cache> = Arc::new(redis.clone());
    // Un tournoi local auquel lier la source (clé étrangère).
    let game: Uuid = sqlx::query_scalar("INSERT INTO games (name) VALUES ($1) RETURNING id")
        .bind(format!("Jeu {tag}"))
        .fetch_one(&pool)
        .await
        .unwrap();
    let tournament: Uuid = sqlx::query_scalar(
        "INSERT INTO tournaments (game_id, name, start_date, end_date, participant_type, \
         max_participants) VALUES ($1, $2, now(), now(), 'solo', 8) RETURNING id",
    )
    .bind(game)
    .bind(format!("Tournoi {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    contract(&store(shared.clone()), &tag, Some(tournament)).await;

    // La base ne garde que le lien : l'instantané, le bail et les événements sont dans Redis.
    let redis_store = store(shared.clone());
    let (source, _) = redis_store
        .register(
            NewSource {
                reference: reference(&format!("c-{tag}")),
                event_ids: Vec::new(),
                tournament_id: Some(tournament),
            },
            0,
        )
        .await
        .unwrap();
    let claimed = redis_store.claim(source.id, 10, 600).await.unwrap();
    assert!(claimed.is_some());
    redis_store
        .save_success(
            source.id,
            610,
            Success {
                snapshot: snapshot("c"),
                capabilities: Capabilities::default(),
                cursor: SyncCursor::default(),
                now: 10,
                next_sync_at: 1_000,
            },
            &[change("m9")],
        )
        .await
        .unwrap();
    let columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name::text FROM information_schema.columns \
         WHERE table_name = 'external_sources' ORDER BY column_name",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        columns,
        [
            "created_at",
            "event_ids",
            "external_id",
            "id",
            "provider",
            "reference",
            "tournament_id"
        ]
    );
    let state: Option<String> = redis
        .connection()
        .get(format!("{prefix}:state:{}", source.id))
        .await
        .unwrap();
    assert!(state.unwrap().contains("\"snapshot\""));

    // État perdu par Redis (vidé, éviction) : la source redevient due, sans instantané, et la
    // prochaine synchronisation en refait un complet.
    let _: () = redis
        .connection()
        .del(format!("{prefix}:state:{}", source.id))
        .await
        .unwrap();
    let lost = redis_store.find(source.id).await.unwrap().unwrap();
    assert!(lost.snapshot.is_none());
    assert_eq!(lost.next_sync_at, 0);
    assert!(
        redis_store
            .claim_due(20, 50, 600)
            .await
            .unwrap()
            .iter()
            .any(|r| r.id == source.id)
    );

    // Supprimer le tournoi local délie la source sans la perdre (lien relu en base, une fois
    // l'entrée en cache expirée).
    sqlx::query("DELETE FROM tournaments WHERE id = $1")
        .bind(tournament)
        .execute(&pool)
        .await
        .unwrap();
    let uncached = store(Arc::new(MemoryCache::new()));
    assert_eq!(
        uncached
            .find(source.id)
            .await
            .unwrap()
            .unwrap()
            .tournament_id,
        None
    );
    assert!(redis_store.delete(source.id).await.unwrap());
    let gone: Option<String> = redis
        .connection()
        .get(format!("{prefix}:state:{}", source.id))
        .await
        .unwrap();
    assert!(gone.is_none());
    assert!(
        !redis_store
            .pending_changes(1000)
            .await
            .unwrap()
            .iter()
            .any(|(_, s, _)| *s == source.id)
    );
    sqlx::query("DELETE FROM games WHERE id = $1")
        .bind(game)
        .execute(&pool)
        .await
        .unwrap();
}

#[test]
fn missing_capabilities_default_to_false() {
    let parsed: Capabilities = serde_json::from_str("{}").unwrap();
    assert_eq!(parsed, Capabilities::default());
}
