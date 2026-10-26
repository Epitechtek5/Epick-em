//! `PgStore` contre un vrai PostgreSQL migré (image `db/`), ignoré par défaut :
//! `DATABASE_URL=… cargo test -p api-public --test postgres -- --ignored`

use api_public::store::{
    AuthStore, GameInput, GameUpdate, MemberImport, ParticipantInput, ParticipantStatus,
    ParticipantType, PgStore, Role, ScoringMode, ScoringRuleDefinition, ScoringRuleInput,
    StatInput, StatType, StatUpdate, StoreError, TeamImport, TeamInput, TeamRole, TeamScoringMode,
    TeamUpdate, TournamentInput, TournamentStatus, TournamentTeamInput, TournamentUpdate,
    UserUpdate,
};
use infra::{CachedDb, MemoryCache};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

async fn store() -> PgStore {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    PgStore::new(CachedDb::new(pool, Arc::new(MemoryCache::new())))
}

/// Nom unique par test : la base est partagée et jamais vidée.
fn unique(prefix: &str) -> String {
    format!("{prefix}-{}", &Uuid::new_v4().simple().to_string()[..12])
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn users_are_unique_whatever_the_case() {
    let store = store().await;
    let name = unique("Alice");

    let user = store.create_user(&name, "hash").await.unwrap();
    assert_eq!(user.username, name);
    assert_eq!(user.role, Role::User);
    assert!(matches!(
        store.create_user(&name.to_lowercase(), "autre").await,
        Err(StoreError::UsernameTaken)
    ));

    let found = store
        .find_user_by_username(&name.to_uppercase())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(found.id, user.id);
    assert_eq!(found.password_hash, "hash");
    assert_eq!(
        store
            .find_user_by_id(user.id)
            .await
            .unwrap()
            .unwrap()
            .username,
        name
    );
    assert!(
        store
            .find_user_by_id(Uuid::new_v4())
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn refresh_tokens_rotate_once_and_can_be_revoked() {
    let store = store().await;
    let user = store.create_user(&unique("rot"), "hash").await.unwrap();
    let ttl = Duration::from_secs(60);
    let (a, b, c) = (unique("a"), unique("b"), unique("c"));

    store.insert_refresh_token(user.id, &a, ttl).await.unwrap();
    let stranger = Uuid::new_v4();
    // Un autre compte ne peut ni utiliser ni révoquer le jeton.
    assert!(
        !store
            .rotate_refresh_token(stranger, &a, &b, ttl)
            .await
            .unwrap()
    );
    store.revoke_refresh_token(stranger, &a).await.unwrap();
    assert!(
        store
            .rotate_refresh_token(user.id, &a, &b, ttl)
            .await
            .unwrap()
    );
    // `a` est consommé, et un échec de rotation n'enregistre rien.
    assert!(
        !store
            .rotate_refresh_token(user.id, &a, &c, ttl)
            .await
            .unwrap()
    );
    assert!(
        !store
            .rotate_refresh_token(user.id, &c, &c, ttl)
            .await
            .unwrap()
    );

    store.revoke_refresh_token(user.id, &b).await.unwrap();
    store.revoke_refresh_token(user.id, &b).await.unwrap();
    assert!(
        !store
            .rotate_refresh_token(user.id, &b, &c, ttl)
            .await
            .unwrap()
    );
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn expired_refresh_tokens_are_refused() {
    let store = store().await;
    let user = store.create_user(&unique("exp"), "hash").await.unwrap();
    let (a, b) = (unique("a"), unique("b"));

    store
        .insert_refresh_token(user.id, &a, Duration::from_millis(100))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        !store
            .rotate_refresh_token(user.id, &a, &b, Duration::from_secs(60))
            .await
            .unwrap()
    );
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn concurrent_rotations_of_one_token_have_a_single_winner() {
    let store = std::sync::Arc::new(store().await);
    let user = store.create_user(&unique("race"), "hash").await.unwrap();
    let ttl = Duration::from_secs(60);
    let old = unique("old");
    store
        .insert_refresh_token(user.id, &old, ttl)
        .await
        .unwrap();

    let attempts = (0..8).map(|_| {
        let (store, old, new) = (store.clone(), old.clone(), unique("new"));
        let user_id = user.id;
        tokio::spawn(async move {
            store
                .rotate_refresh_token(user_id, &old, &new, ttl)
                .await
                .unwrap()
        })
    });
    let mut winners = 0;
    for attempt in attempts {
        winners += usize::from(attempt.await.unwrap());
    }
    assert_eq!(winners, 1);
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn profiles_are_updated_and_the_cache_follows() {
    let store = store().await;
    let name = unique("prof");
    let user = store.create_user(&name, "hash").await.unwrap();

    // Première lecture : mise en cache. La modification doit l'invalider.
    let before = store.find_profile(user.id).await.unwrap().unwrap();
    assert_eq!(
        (before.username.as_str(), before.role),
        (name.as_str(), Role::User)
    );

    let renamed = unique("renamed");
    let updated = store
        .update_user(
            user.id,
            UserUpdate {
                username: Some(renamed.clone()),
                role: Some(Role::Watcher),
                ..UserUpdate::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (updated.username.as_str(), updated.role),
        (renamed.as_str(), Role::Watcher)
    );
    assert_eq!(store.find_profile(user.id).await.unwrap().unwrap(), updated);

    // Les champs non fournis sont conservés, l'empreinte comprise.
    let record = store.find_user_by_id(user.id).await.unwrap().unwrap();
    assert_eq!(record.password_hash, "hash");

    let other = store.create_user(&unique("other"), "hash").await.unwrap();
    assert!(matches!(
        store
            .update_user(
                other.id,
                UserUpdate {
                    username: Some(renamed.to_uppercase()),
                    ..UserUpdate::default()
                },
            )
            .await,
        Err(StoreError::UsernameTaken)
    ));
    assert!(
        store
            .update_user(Uuid::new_v4(), UserUpdate::default())
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn deleting_a_user_clears_the_cache_and_the_refresh_tokens() {
    let store = store().await;
    let user = store.create_user(&unique("del"), "hash").await.unwrap();
    let token = unique("tok");
    store
        .insert_refresh_token(user.id, &token, Duration::from_secs(60))
        .await
        .unwrap();
    assert!(store.find_profile(user.id).await.unwrap().is_some());

    assert!(store.delete_user(user.id).await.unwrap());
    assert!(store.find_profile(user.id).await.unwrap().is_none());
    assert!(!store.delete_user(user.id).await.unwrap());
    assert!(
        !store
            .rotate_refresh_token(user.id, &token, &unique("new"), Duration::from_secs(60))
            .await
            .unwrap()
    );
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn the_watcher_role_is_accepted_by_the_database() {
    let store = store().await;
    let user = store.create_user(&unique("watch"), "hash").await.unwrap();
    let updated = store
        .update_user(
            user.id,
            UserUpdate {
                role: Some(Role::Watcher),
                ..UserUpdate::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(updated.role, Role::Watcher);
    let listed = store.list_profiles(1000, 0).await.unwrap();
    assert!(
        listed
            .iter()
            .any(|p| p.id == user.id && p.role == Role::Watcher)
    );
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn games_are_unique_whatever_the_case_and_seeded() {
    let store = store().await;
    let name = unique("Game");

    let created = store
        .create_game(GameInput {
            name: name.clone(),
            description: "desc".into(),
            images: vec!["https://example.com/a.png".into()],
        })
        .await
        .unwrap();
    assert_eq!(created.images, ["https://example.com/a.png"]);
    assert!(matches!(
        store
            .create_game(GameInput {
                name: name.to_uppercase(),
                description: String::new(),
                images: Vec::new(),
            })
            .await,
        Err(StoreError::GameNameTaken)
    ));

    let updated = store
        .update_game(
            created.id,
            GameUpdate {
                description: Some("autre".into()),
                images: Some(Vec::new()),
                ..GameUpdate::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(updated.name, name);
    assert_eq!(updated.description, "autre");
    assert!(updated.images.is_empty());
    assert_eq!(store.find_game(created.id).await.unwrap(), Some(updated));

    // Les jeux initiaux de la migration 0006 sont présents.
    let names: Vec<_> = store
        .list_games(100, 0)
        .await
        .unwrap()
        .into_iter()
        .map(|g| g.name)
        .collect();
    for seeded in ["Valorant", "Dota 2", "Rocket League"] {
        assert!(names.iter().any(|n| n == seeded), "{seeded}");
    }

    assert!(store.delete_game(created.id).await.unwrap());
    assert!(!store.delete_game(created.id).await.unwrap());
    assert!(store.find_game(created.id).await.unwrap().is_none());
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn games_are_upserted_by_name_in_one_transaction() {
    let store = store().await;
    let existing = unique("Existing");
    let fresh = unique("Fresh");
    let input = |name: &str, description: &str| GameInput {
        name: name.to_string(),
        description: description.to_string(),
        images: Vec::new(),
    };
    let original = store.create_game(input(&existing, "avant")).await.unwrap();

    let saved = store
        .upsert_games(vec![
            input(&existing.to_uppercase(), "après"),
            input(&fresh, "neuf"),
        ])
        .await
        .unwrap();
    assert_eq!(saved.len(), 2);
    assert_eq!((saved[0].0.id, saved[0].1), (original.id, false));
    assert_eq!(saved[0].0.description, "après");
    assert!(saved[1].1);
    assert_eq!(saved[1].0.name, fresh);

    assert!(store.delete_game(original.id).await.unwrap());
    assert!(store.delete_game(saved[1].0.id).await.unwrap());
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn stats_have_unique_keys_and_are_linked_to_games() {
    let store = store().await;
    let key = unique("kills").replace('-', "_");
    let input = |key: &str, kind| StatInput {
        name: "Kills".into(),
        key: key.into(),
        kind,
    };

    let stat = store
        .create_stat(input(&key, StatType::Flat))
        .await
        .unwrap();
    assert_eq!(
        (stat.key.as_str(), stat.kind),
        (key.as_str(), StatType::Flat)
    );
    assert!(matches!(
        store.create_stat(input(&key, StatType::Percent)).await,
        Err(StoreError::StatKeyTaken)
    ));
    let updated = store
        .update_stat(
            stat.id,
            StatUpdate {
                kind: Some(StatType::Percent),
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (updated.name.as_str(), updated.kind),
        ("Kills", StatType::Percent)
    );
    assert_eq!(store.find_stat(stat.id).await.unwrap().unwrap(), updated);

    let game = store
        .create_game(GameInput {
            name: unique("Jeu"),
            description: String::new(),
            images: Vec::new(),
        })
        .await
        .unwrap();
    assert!(store.link_stat(game.id, stat.id).await.unwrap());
    assert!(
        store.link_stat(game.id, stat.id).await.unwrap(),
        "idempotent"
    );
    assert!(!store.link_stat(Uuid::new_v4(), stat.id).await.unwrap());
    assert!(!store.link_stat(game.id, Uuid::new_v4()).await.unwrap());
    assert_eq!(
        store.list_game_stats(game.id).await.unwrap().unwrap(),
        vec![updated.clone()]
    );
    assert!(
        store
            .list_game_stats(Uuid::new_v4())
            .await
            .unwrap()
            .is_none()
    );

    // La suppression du jeu emporte la liaison, pas la statistique.
    assert!(store.delete_game(game.id).await.unwrap());
    assert!(store.find_stat(stat.id).await.unwrap().is_some());
    let other = store
        .create_game(GameInput {
            name: unique("Jeu"),
            description: String::new(),
            images: Vec::new(),
        })
        .await
        .unwrap();
    assert!(store.link_stat(other.id, stat.id).await.unwrap());
    assert!(store.unlink_stat(other.id, stat.id).await.unwrap());
    assert!(!store.unlink_stat(other.id, stat.id).await.unwrap());
    assert!(store.link_stat(other.id, stat.id).await.unwrap());

    assert!(store.delete_stat(stat.id).await.unwrap());
    assert!(!store.delete_stat(stat.id).await.unwrap());
    assert!(
        store
            .list_game_stats(other.id)
            .await
            .unwrap()
            .unwrap()
            .is_empty()
    );
    store.delete_game(other.id).await.unwrap();
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn stats_are_upserted_by_key_and_links_are_replaced() {
    let store = store().await;
    let (key_a, key_b) = (unique("a").replace('-', "_"), unique("b").replace('-', "_"));
    let input = |name: &str, key: &str, kind| StatInput {
        name: name.into(),
        key: key.into(),
        kind,
    };
    let game = |name: String| GameInput {
        name,
        description: String::new(),
        images: Vec::new(),
    };
    let (g1, g2) = (
        store.create_game(game(unique("Jeu"))).await.unwrap(),
        store.create_game(game(unique("Jeu"))).await.unwrap(),
    );

    let saved = store
        .upsert_stats(vec![
            input("A", &key_a, StatType::Flat),
            input("B", &key_b, StatType::Flat),
        ])
        .await
        .unwrap();
    assert!(saved.iter().all(|(_, created)| *created));
    let (a, b) = (saved[0].0.clone(), saved[1].0.clone());

    let again = store
        .upsert_stats(vec![input("A2", &key_a, StatType::Percent)])
        .await
        .unwrap();
    assert!(!again[0].1);
    assert_eq!((again[0].0.id, again[0].0.name.as_str()), (a.id, "A2"));
    assert_eq!(again[0].0.kind, StatType::Percent);

    assert!(store.set_game_stats(g1.id, vec![a.id, b.id]).await.unwrap());
    assert!(store.set_game_stats(g1.id, vec![b.id]).await.unwrap());
    let linked = store.list_game_stats(g1.id).await.unwrap().unwrap();
    assert_eq!(linked.iter().map(|s| s.id).collect::<Vec<_>>(), [b.id]);
    // Une statistique ou un jeu inconnu laisse les liaisons intactes.
    assert!(
        !store
            .set_game_stats(g1.id, vec![a.id, Uuid::new_v4()])
            .await
            .unwrap()
    );
    assert!(
        !store
            .set_game_stats(Uuid::new_v4(), vec![a.id])
            .await
            .unwrap()
    );
    assert_eq!(
        store.list_game_stats(g1.id).await.unwrap().unwrap().len(),
        1
    );

    assert!(store.set_stat_games(b.id, vec![g2.id]).await.unwrap());
    assert!(
        store
            .list_game_stats(g1.id)
            .await
            .unwrap()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        store.list_game_stats(g2.id).await.unwrap().unwrap().len(),
        1
    );
    assert!(
        !store
            .set_stat_games(b.id, vec![g1.id, Uuid::new_v4()])
            .await
            .unwrap()
    );
    assert_eq!(
        store.list_game_stats(g2.id).await.unwrap().unwrap().len(),
        1
    );

    for id in [a.id, b.id] {
        store.delete_stat(id).await.unwrap();
    }
    for id in [g1.id, g2.id] {
        store.delete_game(id).await.unwrap();
    }
}

async fn user(store: &PgStore, prefix: &str) -> Uuid {
    store.create_user(&unique(prefix), "hash").await.unwrap().id
}

async fn game(store: &PgStore) -> Uuid {
    store
        .create_game(GameInput {
            name: unique("Jeu"),
            description: String::new(),
            images: Vec::new(),
        })
        .await
        .unwrap()
        .id
}

/// Tournoi créé en SQL (le store n'expose pas encore de création de tournoi).
async fn insert_tournament(game_id: Uuid) -> Uuid {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::query_scalar(
        "INSERT INTO tournaments (game_id, name, start_date, end_date, participant_type, team_size, max_participants) \
         VALUES ($1, $2, now(), now() + interval '1 day', 'team', 5, 8) RETURNING id",
    )
    .bind(game_id)
    .bind(unique("Tournoi"))
    .fetch_one(&pool)
    .await
    .unwrap()
}

fn team_input(game_id: Uuid, name: &str, owner_id: Uuid) -> TeamInput {
    TeamInput {
        game_id,
        name: name.to_string(),
        tag: Some("KC".into()),
        picture_url: Some("https://img.example/kc.png".into()),
        owner_id,
    }
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn teams_have_an_owner_member_and_unique_names_per_game() {
    let store = store().await;
    let (alice, bob) = (user(&store, "alice").await, user(&store, "bob").await);
    let game_id = game(&store).await;
    let name = unique("Karmine");

    let team = store
        .create_team(team_input(game_id, &name, alice))
        .await
        .unwrap();
    assert_eq!((team.owner_id, team.tag.as_deref()), (alice, Some("KC")));
    assert!(team.created_at.ends_with('Z') && team.created_at.len() == 27);
    let members = store.list_team_members(team.id).await.unwrap().unwrap();
    assert_eq!(members.len(), 1);
    assert_eq!(
        (members[0].user_id, members[0].role),
        (alice, TeamRole::Owner)
    );
    assert!(members[0].left_at.is_none());

    // Unique par jeu sans tenir compte de la casse, mais pas d'un jeu à l'autre.
    assert!(matches!(
        store
            .create_team(team_input(game_id, &name.to_uppercase(), bob))
            .await,
        Err(StoreError::TeamNameTaken)
    ));
    let other = store
        .create_team(team_input(game(&store).await, &name, bob))
        .await
        .unwrap();
    assert!(matches!(
        store
            .update_team(
                other.id,
                TeamUpdate {
                    name: Some(name.clone()),
                    ..Default::default()
                }
            )
            .await,
        Ok(Some(_))
    ));

    // `Some(None)` efface une valeur facultative, `None` la garde.
    let updated = store
        .update_team(
            team.id,
            TeamUpdate {
                tag: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(updated.tag, None);
    assert_eq!(updated.picture_url, team.picture_url);
    assert_eq!(updated.name, name);
    assert!(
        store
            .update_team(Uuid::new_v4(), TeamUpdate::default())
            .await
            .unwrap()
            .is_none()
    );

    let listed = store.list_teams(Some(game_id), 10, 0).await.unwrap();
    assert_eq!(listed.iter().map(|t| t.id).collect::<Vec<_>>(), [team.id]);

    // Membres : doublon refusé, compte inconnu, départ puis retour.
    let member = store
        .add_team_member(team.id, bob, TeamRole::Member)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(member.role, TeamRole::Member);
    assert!(matches!(
        store
            .add_team_member(team.id, bob, TeamRole::Substitute)
            .await,
        Err(StoreError::AlreadyTeamMember)
    ));
    assert!(
        store
            .add_team_member(team.id, Uuid::new_v4(), TeamRole::Member)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        store
            .add_team_member(Uuid::new_v4(), bob, TeamRole::Member)
            .await
            .unwrap()
            .is_none()
    );
    let changed = store
        .set_team_member_role(team.id, bob, TeamRole::Substitute)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(changed.role, TeamRole::Substitute);
    assert!(store.remove_team_member(team.id, bob).await.unwrap());
    assert!(!store.remove_team_member(team.id, bob).await.unwrap());
    assert!(
        store
            .set_team_member_role(team.id, bob, TeamRole::Member)
            .await
            .unwrap()
            .is_none()
    );
    store
        .add_team_member(team.id, bob, TeamRole::Member)
        .await
        .unwrap()
        .unwrap();
    let members = store.list_team_members(team.id).await.unwrap().unwrap();
    assert_eq!(members.len(), 3);
    assert_eq!(members.iter().filter(|m| m.left_at.is_some()).count(), 1);

    // Supprimer le jeu supprime ses équipes.
    assert!(store.delete_game(game_id).await.unwrap());
    assert!(store.find_team(team.id).await.unwrap().is_none());
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn tournament_teams_are_independent_copies() {
    let store = store().await;
    let (alice, bob, carol) = (
        user(&store, "alice").await,
        user(&store, "bob").await,
        user(&store, "carol").await,
    );
    let game_id = game(&store).await;
    let team = store
        .create_team(team_input(game_id, &unique("Karmine"), alice))
        .await
        .unwrap();
    let tournament = insert_tournament(game_id).await;
    let copy_input = |team_id: Option<Uuid>, members: Vec<(Uuid, TeamRole)>| TournamentTeamInput {
        tournament_id: tournament,
        team_id,
        name: team.name.clone(),
        tag: team.tag.clone(),
        picture_url: team.picture_url.clone(),
        owner_id: alice,
        members,
    };

    let copy = store
        .create_tournament_team(copy_input(
            Some(team.id),
            vec![(alice, TeamRole::Owner), (bob, TeamRole::Member)],
        ))
        .await
        .unwrap();
    assert_eq!(copy.team_id, Some(team.id));
    let members = store
        .list_tournament_team_members(copy.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(members.len(), 2);

    // Une équipe globale s'inscrit une fois par tournoi ; un joueur dans une seule équipe.
    assert!(matches!(
        store
            .create_tournament_team(copy_input(Some(team.id), vec![(carol, TeamRole::Owner)]))
            .await,
        Err(StoreError::TeamAlreadyRegistered)
    ));
    assert!(matches!(
        store
            .create_tournament_team(copy_input(None, vec![(bob, TeamRole::Owner)]))
            .await,
        Err(StoreError::PlayerAlreadyRegistered)
    ));
    // L'échec n'a rien laissé : ni équipe, ni membre.
    assert_eq!(
        store
            .list_tournament_teams(tournament, 10, 0)
            .await
            .unwrap()
            .len(),
        1
    );
    let scratch = store
        .create_tournament_team(copy_input(None, vec![(carol, TeamRole::Owner)]))
        .await
        .unwrap();
    assert!(matches!(
        store
            .add_tournament_team_member(scratch.id, bob, TeamRole::Member)
            .await,
        Err(StoreError::PlayerAlreadyRegistered)
    ));
    assert!(
        store
            .add_tournament_team_member(scratch.id, Uuid::new_v4(), TeamRole::Member)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        store
            .add_tournament_team_member(Uuid::new_v4(), bob, TeamRole::Member)
            .await
            .unwrap()
            .is_none()
    );
    // Même joueur, autre tournoi : permis.
    let elsewhere = TournamentTeamInput {
        tournament_id: insert_tournament(game_id).await,
        ..copy_input(None, vec![(bob, TeamRole::Owner)])
    };
    store.create_tournament_team(elsewhere).await.unwrap();

    // Aucune propagation, dans un sens comme dans l'autre.
    store
        .update_tournament_team(
            copy.id,
            TeamUpdate {
                name: Some(unique("Copie")),
                picture_url: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        store.find_team(team.id).await.unwrap().unwrap().name,
        team.name
    );
    store
        .update_team(
            team.id,
            TeamUpdate {
                tag: Some(Some("NEW".into())),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let copy_now = store.find_tournament_team(copy.id).await.unwrap().unwrap();
    assert_eq!(copy_now.tag.as_deref(), Some("KC"));
    assert_eq!(copy_now.picture_url, None);

    // Supprimer l'équipe globale garde la copie et ses membres.
    assert!(store.delete_team(team.id).await.unwrap());
    let orphan = store.find_tournament_team(copy.id).await.unwrap().unwrap();
    assert_eq!(orphan.team_id, None);
    assert_eq!(
        store
            .list_tournament_team_members(copy.id)
            .await
            .unwrap()
            .unwrap()
            .len(),
        2
    );

    let role = store
        .set_tournament_team_member_role(copy.id, bob, TeamRole::Substitute)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(role.role, TeamRole::Substitute);
    assert!(
        store
            .remove_tournament_team_member(copy.id, bob)
            .await
            .unwrap()
    );
    assert!(
        !store
            .remove_tournament_team_member(copy.id, bob)
            .await
            .unwrap()
    );
    assert!(store.delete_tournament_team(copy.id).await.unwrap());
    assert!(
        store
            .list_tournament_team_members(copy.id)
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn teams_are_upserted_with_their_members_in_one_transaction() {
    let store = store().await;
    let (alice, bob, carol) = (
        user(&store, "alice").await,
        user(&store, "bob").await,
        user(&store, "carol").await,
    );
    let game_id = game(&store).await;
    let name = unique("Karmine");
    let member = |user_id, role, joined: Option<&str>, left: Option<&str>| MemberImport {
        user_id,
        role,
        joined_at: joined.map(str::to_string),
        left_at: left.map(str::to_string),
    };
    let input = |name: &str, owner, members| TeamImport {
        game_id,
        name: name.to_string(),
        tag: Some("KC".into()),
        picture_url: None,
        owner_id: owner,
        members,
    };

    let saved = store
        .import_teams(vec![input(
            &name,
            alice,
            vec![
                member(
                    alice,
                    TeamRole::Owner,
                    Some("2026-01-02T03:04:05.123456Z"),
                    None,
                ),
                member(
                    bob,
                    TeamRole::Substitute,
                    Some("2026-01-03T00:00:00.000000Z"),
                    Some("2026-02-03T00:00:00.000000Z"),
                ),
            ],
        )])
        .await
        .unwrap();
    assert!(saved[0].1);
    let team = saved[0].0.clone();
    let members = store.list_team_members(team.id).await.unwrap().unwrap();
    assert_eq!(members[0].joined_at, "2026-01-02T03:04:05.123456Z");
    assert_eq!(
        members[1].left_at.as_deref(),
        Some("2026-02-03T00:00:00.000000Z")
    );

    // Même équipe (nom en majuscules) : mise à jour, membres remplacés, identifiant conservé.
    let saved = store
        .import_teams(vec![input(
            &name.to_uppercase(),
            carol,
            vec![member(carol, TeamRole::Owner, None, None)],
        )])
        .await
        .unwrap();
    assert!(!saved[0].1);
    assert_eq!(saved[0].0.id, team.id);
    assert_eq!(saved[0].0.owner_id, carol);
    assert_eq!(saved[0].0.name, name.to_uppercase());
    let members = store.list_team_members(team.id).await.unwrap().unwrap();
    assert_eq!(members.len(), 1);
    assert_eq!(members[0].user_id, carol);

    // Un lot qui échoue (deux propriétaires actifs) n'écrit rien, pas même ses équipes valides.
    let other = unique("Autre");
    let failed = store
        .import_teams(vec![
            input(
                &other,
                alice,
                vec![member(alice, TeamRole::Owner, None, None)],
            ),
            input(
                &unique("Cassée"),
                alice,
                vec![
                    member(alice, TeamRole::Owner, None, None),
                    member(bob, TeamRole::Owner, None, None),
                ],
            ),
        ])
        .await;
    assert!(failed.is_err());
    let names: Vec<String> = store
        .list_teams(Some(game_id), 10, 0)
        .await
        .unwrap()
        .into_iter()
        .map(|t| t.name)
        .collect();
    assert_eq!(names, [name.to_uppercase()]);
}

fn tournament_input(game_id: Uuid) -> TournamentInput {
    TournamentInput {
        game_id,
        name: unique("Open"),
        description: Some("Ouvert".into()),
        start_date: "2026-11-14T18:00:00.000000Z".into(),
        end_date: "2026-11-15T18:00:00.000000Z".into(),
        registration_open_at: Some("2026-11-01T00:00:00.000000Z".into()),
        registration_close_at: None,
        participant_type: ParticipantType::Solo,
        team_size: None,
        max_participants: 2,
        team_scoring_mode: TeamScoringMode::TopN,
        team_scoring_n: Some(2),
    }
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn tournaments_round_trip_and_update_partially() {
    let store = store().await;
    let game_id = game(&store).await;
    let created = store
        .create_tournament(tournament_input(game_id))
        .await
        .unwrap();
    assert_eq!(created.status, TournamentStatus::Draft);
    assert_eq!(created.start_date, "2026-11-14T18:00:00.000000Z");
    assert_eq!(created.team_scoring_mode, TeamScoringMode::TopN);
    assert_eq!(
        store.find_tournament(created.id).await.unwrap(),
        Some(created.clone())
    );

    let updated = store
        .update_tournament(
            created.id,
            TournamentUpdate {
                name: Some(unique("Cup")),
                description: Some(None),
                registration_open_at: Some(None),
                max_participants: Some(4),
                team_scoring_mode: Some(TeamScoringMode::Sum),
                team_scoring_n: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(updated.description, None);
    assert_eq!(updated.registration_open_at, None);
    assert_eq!(updated.max_participants, 4);
    assert_eq!(updated.end_date, created.end_date);
    assert!(
        store
            .update_tournament(Uuid::new_v4(), TournamentUpdate::default())
            .await
            .unwrap()
            .is_none()
    );

    let started = store
        .set_tournament_status(created.id, TournamentStatus::Registration)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(started.status, TournamentStatus::Registration);
    let listed = store
        .list_tournaments(Some(game_id), Some(TournamentStatus::Registration), 10, 0)
        .await
        .unwrap();
    assert_eq!(listed.len(), 1);
    assert!(
        store
            .list_tournaments(Some(game_id), Some(TournamentStatus::Draft), 10, 0)
            .await
            .unwrap()
            .is_empty()
    );

    // Les contraintes de la base refusent un tournoi incohérent.
    let mut bad = tournament_input(game_id);
    bad.team_size = Some(3);
    assert!(store.create_tournament(bad).await.is_err());

    assert!(store.delete_tournament(created.id).await.unwrap());
    assert!(!store.delete_tournament(created.id).await.unwrap());
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn scoring_rules_need_a_stat_of_the_game_and_lock_it_when_ongoing() {
    let store = store().await;
    let game_id = game(&store).await;
    let other_game = game(&store).await;
    let key = unique("kills").replace('-', "_").to_lowercase();
    let stat = store
        .create_stat(StatInput {
            name: "Kills".into(),
            key,
            kind: StatType::Flat,
        })
        .await
        .unwrap();
    let tournament = store
        .create_tournament(tournament_input(game_id))
        .await
        .unwrap();
    let linear = ScoringRuleDefinition {
        mode: ScoringMode::Linear,
        coefficient: Some(1.5),
        points_table: None,
    };
    let rule = |definition: &ScoringRuleDefinition| ScoringRuleInput {
        tournament_id: tournament.id,
        stat_id: stat.id,
        definition: definition.clone(),
    };

    // Statistique non liée au jeu du tournoi : refusée.
    assert!(
        store
            .create_scoring_rule(rule(&linear))
            .await
            .unwrap()
            .is_none()
    );
    assert!(store.link_stat(other_game, stat.id).await.unwrap());
    assert!(
        store
            .create_scoring_rule(rule(&linear))
            .await
            .unwrap()
            .is_none()
    );
    assert!(store.link_stat(game_id, stat.id).await.unwrap());
    let created = store
        .create_scoring_rule(rule(&linear))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(created.coefficient, Some(1.5));
    assert!(matches!(
        store.create_scoring_rule(rule(&linear)).await,
        Err(StoreError::ScoringRuleTaken)
    ));

    let table = ScoringRuleDefinition {
        mode: ScoringMode::Table,
        coefficient: None,
        points_table: Some(serde_json::json!({ "1": 8, "2": 7 })),
    };
    let replaced = store
        .replace_scoring_rule(created.id, table)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(replaced.coefficient, None);
    assert_eq!(
        replaced.points_table,
        Some(serde_json::json!({ "1": 8, "2": 7 }))
    );
    assert_eq!(
        store.list_scoring_rules(tournament.id).await.unwrap().len(),
        1
    );
    assert_eq!(
        store.find_scoring_rule(created.id).await.unwrap(),
        Some(replaced)
    );

    // Tournoi `ongoing` : la statistique et sa liaison au jeu ne se retirent plus.
    store
        .set_tournament_status(tournament.id, TournamentStatus::Ongoing)
        .await
        .unwrap();
    assert!(matches!(
        store.delete_stat(stat.id).await,
        Err(StoreError::StatInUse)
    ));
    assert!(matches!(
        store.unlink_stat(game_id, stat.id).await,
        Err(StoreError::StatInUse)
    ));
    assert!(matches!(
        store.set_game_stats(game_id, Vec::new()).await,
        Err(StoreError::StatInUse)
    ));
    assert!(matches!(
        store.set_stat_games(stat.id, vec![other_game]).await,
        Err(StoreError::StatInUse)
    ));
    // Une autre liaison se retire, et le remplacement qui garde la liaison passe.
    assert!(store.unlink_stat(other_game, stat.id).await.unwrap());
    assert!(store.set_game_stats(game_id, vec![stat.id]).await.unwrap());

    // Fini : la statistique redevient supprimable et le barème disparaît avec elle.
    store
        .set_tournament_status(tournament.id, TournamentStatus::Finished)
        .await
        .unwrap();
    assert!(store.delete_stat(stat.id).await.unwrap());
    assert!(
        store
            .list_scoring_rules(tournament.id)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(!store.delete_scoring_rule(created.id).await.unwrap());
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn participants_are_unique_and_capped_by_max_participants() {
    let store = store().await;
    let (alice, bob, carol) = (
        user(&store, "alice").await,
        user(&store, "bob").await,
        user(&store, "carol").await,
    );
    let game_id = game(&store).await;
    let tournament = store
        .create_tournament(tournament_input(game_id))
        .await
        .unwrap();
    let solo = |user_id: Uuid| ParticipantInput {
        tournament_id: tournament.id,
        user_id: Some(user_id),
        tournament_team_id: None,
    };

    let first = store.add_participant(solo(alice)).await.unwrap().unwrap();
    assert_eq!(first.status, ParticipantStatus::Registered);
    assert!(matches!(
        store.add_participant(solo(alice)).await,
        Err(StoreError::AlreadyParticipant)
    ));
    let second = store.add_participant(solo(bob)).await.unwrap().unwrap();
    assert!(matches!(
        store.add_participant(solo(carol)).await,
        Err(StoreError::TournamentFull)
    ));
    assert!(
        store
            .add_participant(ParticipantInput {
                tournament_id: Uuid::new_v4(),
                user_id: Some(carol),
                tournament_team_id: None,
            })
            .await
            .unwrap()
            .is_none()
    );

    // Un retrait libère la place sans effacer la ligne.
    let withdrawn = store
        .set_participant_status(second.id, ParticipantStatus::Withdrawn)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(withdrawn.status, ParticipantStatus::Withdrawn);
    store.add_participant(solo(carol)).await.unwrap().unwrap();
    let listed = store.list_participants(tournament.id, 10, 0).await.unwrap();
    assert_eq!(listed.len(), 3);
    assert_eq!(listed[0], first);
    assert_eq!(
        store.find_participant(first.id).await.unwrap(),
        Some(first.clone())
    );
    assert!(
        store
            .participant_points(tournament.id)
            .await
            .unwrap()
            .is_empty()
    );

    assert!(store.delete_participant(first.id).await.unwrap());
    assert!(!store.delete_participant(first.id).await.unwrap());
    assert!(
        store
            .set_participant_status(first.id, ParticipantStatus::CheckedIn)
            .await
            .unwrap()
            .is_none()
    );

    // Solo avec équipe : plusieurs joueurs pour la même équipe ; équipe seule : une fois.
    let team_tournament = store
        .create_tournament(tournament_input(game_id))
        .await
        .unwrap();
    let team = store
        .create_tournament_team(TournamentTeamInput {
            tournament_id: team_tournament.id,
            team_id: None,
            name: unique("Alpha"),
            tag: None,
            picture_url: None,
            owner_id: alice,
            members: vec![(alice, TeamRole::Owner), (bob, TeamRole::Member)],
        })
        .await
        .unwrap();
    for user_id in [alice, bob] {
        store
            .add_participant(ParticipantInput {
                tournament_id: team_tournament.id,
                user_id: Some(user_id),
                tournament_team_id: Some(team.id),
            })
            .await
            .unwrap()
            .unwrap();
    }
    // Une équipe d'un autre tournoi est refusée par la base.
    assert!(
        store
            .add_participant(ParticipantInput {
                tournament_id: tournament.id,
                user_id: Some(carol),
                tournament_team_id: Some(team.id),
            })
            .await
            .is_err()
    );
    // Supprimer le tournoi emporte ses inscrits.
    assert!(store.delete_tournament(team_tournament.id).await.unwrap());
    assert!(
        store
            .list_participants(team_tournament.id, 10, 0)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(store.find_tournament_team(team.id).await.unwrap().is_none());
}
