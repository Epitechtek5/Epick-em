//! Contrat commun des [`SyncStore`] : le même parcours sur le store en mémoire et sur
//! PostgreSQL.
//!
//! Le test PostgreSQL est ignoré par défaut ; il lui faut une base migrée par Liquibase :
//! `DATABASE_URL=postgres://… cargo test -p connectors --test sync_store -- --ignored`.

use connectors::model::{
    Capabilities, CompetitionState, ExternalTournament, ExternalTournamentRef, SyncCursor,
};
use connectors::sync::{
    ChangeEvent, ChangeKind, MemorySyncStore, NewSource, PgSyncStore, StoreError, Success,
    SyncStore,
};
use serde_json::json;
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

    // Échec : l'instantané reste, l'erreur et le compteur sont enregistrés.
    store
        .save_failure(first.id, "HTTP 503", now + 3, now + 63)
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
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn postgres_store_honours_the_contract() {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    let tag = Uuid::new_v4().simple().to_string();
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
    contract(&PgSyncStore::new(pool.clone()), &tag, Some(tournament)).await;

    // Supprimer le tournoi local délie la source sans la perdre.
    let (source, _) = PgSyncStore::new(pool.clone())
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
    sqlx::query("DELETE FROM tournaments WHERE id = $1")
        .bind(tournament)
        .execute(&pool)
        .await
        .unwrap();
    let store = PgSyncStore::new(pool.clone());
    assert_eq!(
        store.find(source.id).await.unwrap().unwrap().tournament_id,
        None
    );
    store.delete(source.id).await.unwrap();
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
