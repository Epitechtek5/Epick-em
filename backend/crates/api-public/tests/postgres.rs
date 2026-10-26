//! `PgStore` contre un vrai PostgreSQL migré (image `db/`), ignoré par défaut :
//! `DATABASE_URL=… cargo test -p api-public --test postgres -- --ignored`

use api_public::step_io::StoreSteps;
use api_public::store::{
    AuthStore, Bracket, GameInput, GameUpdate, MatchFinish, MatchInput, MatchResult, MatchScore,
    MatchStatus, MatchType, MatchUpdate, MemberImport, ParticipantImport, ParticipantInput,
    ParticipantStatus, ParticipantType, PgStore, Role, ScoringMode, ScoringRuleDefinition,
    ScoringRuleImport, ScoringRuleInput, StatInput, StatType, StatUpdate, StepClosing,
    StepDefinition, StepFormat, StepInput, StepOutcome, StepParticipantStatus, StepStart,
    StepStatus, StoreError, TeamImport, TeamInput, TeamRole, TeamScoringMode, TeamUpdate,
    TournamentImport, TournamentInput, TournamentStatus, TournamentTeamInput, TournamentUpdate,
    UserUpdate,
};
use api_public::tournament_io::{FileScope, TournamentChild};
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

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn tournaments_are_unique_per_game_and_upserted_by_name() {
    let store = store().await;
    let (alice, bob) = (user(&store, "alice").await, user(&store, "bob").await);
    let game_id = game(&store).await;
    let stat = store
        .create_stat(StatInput {
            name: "Kills".into(),
            key: unique("kills").replace('-', "_").to_lowercase(),
            kind: StatType::Flat,
        })
        .await
        .unwrap();
    assert!(store.link_stat(game_id, stat.id).await.unwrap());

    // Le nom est unique par jeu, sans tenir compte de la casse.
    let first = store
        .create_tournament(tournament_input(game_id))
        .await
        .unwrap();
    let mut clash = tournament_input(game_id);
    clash.name = first.name.to_uppercase();
    assert!(matches!(
        store.create_tournament(clash).await,
        Err(StoreError::TournamentNameTaken)
    ));
    let second = store
        .create_tournament(tournament_input(game_id))
        .await
        .unwrap();
    assert!(matches!(
        store
            .update_tournament(
                second.id,
                TournamentUpdate {
                    name: Some(first.name.to_lowercase()),
                    ..Default::default()
                },
            )
            .await,
        Err(StoreError::TournamentNameTaken)
    ));
    // Un autre jeu peut réutiliser le nom.
    let mut elsewhere = tournament_input(game(&store).await);
    elsewhere.name = first.name.clone();
    store.create_tournament(elsewhere).await.unwrap();

    let rule = |coefficient: f64| ScoringRuleImport {
        stat_id: stat.id,
        definition: ScoringRuleDefinition {
            mode: ScoringMode::Linear,
            coefficient: Some(coefficient),
            points_table: None,
        },
    };
    let mut renamed = tournament_input(game_id);
    renamed.name = first.name.to_uppercase();
    renamed.max_participants = 8;
    let fresh = tournament_input(game_id);
    let saved = store
        .import_tournaments(vec![
            TournamentImport {
                input: renamed,
                status: TournamentStatus::Registration,
                rules: vec![rule(2.0)],
            },
            TournamentImport {
                input: fresh.clone(),
                status: TournamentStatus::Draft,
                rules: Vec::new(),
            },
        ])
        .await
        .unwrap();
    assert_eq!(saved.len(), 2);
    assert_eq!((saved[0].0.id, saved[0].1), (first.id, false));
    assert_eq!(saved[0].0.status, TournamentStatus::Registration);
    assert_eq!(saved[0].0.max_participants, 8);
    assert!(saved[1].1);
    let rules = store.list_scoring_rules(first.id).await.unwrap();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0].coefficient, Some(2.0));

    // Réimporter remplace le barème.
    let again = store
        .import_tournaments(vec![TournamentImport {
            input: tournament_input_named(game_id, &first.name),
            status: TournamentStatus::Draft,
            rules: vec![rule(3.0)],
        }])
        .await
        .unwrap();
    assert!(!again[0].1);
    let rules = store.list_scoring_rules(first.id).await.unwrap();
    assert_eq!((rules.len(), rules[0].coefficient), (1, Some(3.0)));

    // Un lot en échec n'écrit rien : la statistique n'est pas liée à l'autre jeu.
    let before = store
        .list_tournaments(Some(game_id), None, 100, 0)
        .await
        .unwrap()
        .len();
    let stray = store
        .import_tournaments(vec![
            TournamentImport {
                input: tournament_input(game_id),
                status: TournamentStatus::Draft,
                rules: Vec::new(),
            },
            TournamentImport {
                input: tournament_input(game(&store).await),
                status: TournamentStatus::Draft,
                rules: vec![rule(1.0)],
            },
        ])
        .await;
    assert!(stray.is_err());
    assert_eq!(
        store
            .list_tournaments(Some(game_id), None, 100, 0)
            .await
            .unwrap()
            .len(),
        before
    );

    // Les inscrits se remplacent d'un bloc.
    let participant = |user_id: Uuid, status: ParticipantStatus| ParticipantImport {
        user_id: Some(user_id),
        tournament_team_id: None,
        status,
        registered_at: Some("2026-11-02T08:00:00.000000Z".into()),
    };
    store
        .add_participant(ParticipantInput {
            tournament_id: first.id,
            user_id: Some(alice),
            tournament_team_id: None,
        })
        .await
        .unwrap();
    store
        .replace_participants(
            first.id,
            vec![
                participant(bob, ParticipantStatus::CheckedIn),
                ParticipantImport {
                    registered_at: Some("2026-11-03T08:00:00.000000Z".into()),
                    ..participant(alice, ParticipantStatus::Registered)
                },
            ],
        )
        .await
        .unwrap();
    let listed = store.list_participants(first.id, 10, 0).await.unwrap();
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].user_id, Some(bob));
    assert_eq!(listed[0].registered_at, "2026-11-02T08:00:00.000000Z");
    assert_eq!(listed[0].status, ParticipantStatus::CheckedIn);
    // Un doublon fait échouer le remplacement, qui laisse l'existant intact.
    assert!(
        store
            .replace_participants(
                first.id,
                vec![
                    participant(bob, ParticipantStatus::Registered),
                    participant(bob, ParticipantStatus::Registered),
                ],
            )
            .await
            .is_err()
    );
    assert_eq!(
        store
            .list_participants(first.id, 10, 0)
            .await
            .unwrap()
            .len(),
        2
    );
}

fn tournament_input_named(game_id: Uuid, name: &str) -> TournamentInput {
    TournamentInput {
        name: name.to_string(),
        ..tournament_input(game_id)
    }
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn step_tables_enforce_their_constraints() {
    let store = store().await;
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    let game_id = game(&store).await;
    let alice = user(&store, "alice").await;
    let first = store
        .create_tournament(tournament_input(game_id))
        .await
        .unwrap();
    let second = store
        .create_tournament(tournament_input(game_id))
        .await
        .unwrap();
    let participant = store
        .add_participant(ParticipantInput {
            tournament_id: first.id,
            user_id: Some(alice),
            tournament_team_id: None,
        })
        .await
        .unwrap()
        .unwrap();

    let insert_step = |tournament: Uuid, position: i32, format: &str, groups: i32, advance: i32| {
        let pool = pool.clone();
        let format = format.to_string();
        async move {
            sqlx::query_scalar::<_, Uuid>(
                "INSERT INTO step (tournament_id, position, format, match_type, group_count, \
                 group_size, matches_per_group, advance_per_group) \
                 VALUES ($1, $2, $3, 'ffa', $4, 4, 3, $5) RETURNING id",
            )
            .bind(tournament)
            .bind(position)
            .bind(format)
            .bind(groups)
            .bind(advance)
            .fetch_one(&pool)
            .await
        }
    };

    let step = insert_step(first.id, 1, "pool", 2, 2).await.unwrap();
    // Position unique par tournoi, qualifiés au plus égaux à la taille du groupe, un seul groupe
    // hors `pool`, format connu.
    assert!(insert_step(first.id, 1, "pool", 2, 2).await.is_err());
    assert!(insert_step(first.id, 2, "pool", 2, 5).await.is_err());
    assert!(insert_step(first.id, 2, "swiss", 2, 2).await.is_err());
    assert!(insert_step(first.id, 2, "ladder", 1, 2).await.is_err());
    assert!(insert_step(first.id, 2, "swiss", 1, 2).await.is_ok());

    let group = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO step_group (step_id, index) VALUES ($1, 1) RETURNING id",
    )
    .bind(step)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        sqlx::query("INSERT INTO step_group (step_id, index) VALUES ($1, 1)")
            .bind(step)
            .execute(&pool)
            .await
            .is_err()
    );

    let enroll = |tournament: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query(
                "INSERT INTO step_participant (step_id, tournament_id, participant_id, group_id) \
                 VALUES ($1, $2, $3, $4)",
            )
            .bind(step)
            .bind(tournament)
            .bind(participant.id)
            .bind(group)
            .execute(&pool)
            .await
        }
    };
    // L'inscrit doit appartenir au tournoi de l'étape.
    assert!(enroll(second.id).await.is_err());
    enroll(first.id).await.unwrap();
    assert!(enroll(first.id).await.is_err());
    let (points, status): (f64, String) =
        sqlx::query_as("SELECT points::float8, status FROM step_participant WHERE step_id = $1")
            .bind(step)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((points, status.as_str()), (0.0, "in"));
    assert!(
        sqlx::query("UPDATE step_participant SET final_rank = 0")
            .execute(&pool)
            .await
            .is_err()
    );

    // Supprimer le tournoi emporte ses étapes.
    sqlx::query("DELETE FROM tournaments WHERE id = $1")
        .bind(first.id)
        .execute(&pool)
        .await
        .unwrap();
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM step WHERE id = $1")
        .bind(step)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0);
}

fn step_definition(
    position: i32,
    group_count: i32,
    group_size: i32,
    advance: i32,
) -> StepDefinition {
    StepDefinition {
        position,
        format: StepFormat::Pool,
        match_type: MatchType::Ffa,
        group_count,
        group_size,
        matches_per_group: 3,
        advance_per_group: advance,
        tiebreak: serde_json::json!(["wins"]),
    }
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn steps_start_close_and_open_the_next_one_atomically() {
    let store = store().await;
    let game_id = game(&store).await;
    let tournament = store
        .create_tournament(TournamentInput {
            max_participants: 4,
            ..tournament_input(game_id)
        })
        .await
        .unwrap();
    let mut players = Vec::new();
    for name in ["a", "b", "c", "d"] {
        let user_id = user(&store, name).await;
        let participant = store
            .add_participant(ParticipantInput {
                tournament_id: tournament.id,
                user_id: Some(user_id),
                tournament_team_id: None,
            })
            .await
            .unwrap();
        players.push(participant.unwrap().id);
    }

    let create = |input: StepDefinition| {
        store.create_step(StepInput {
            tournament_id: tournament.id,
            definition: input,
        })
    };
    let first = create(step_definition(1, 1, 4, 2)).await.unwrap().unwrap();
    let last = create(step_definition(2, 1, 2, 1)).await.unwrap().unwrap();
    assert_eq!(first.status, StepStatus::Pending);
    assert_eq!(first.tiebreak, serde_json::json!(["wins"]));
    assert!(matches!(
        create(step_definition(1, 1, 4, 2)).await,
        Err(StoreError::StepPositionTaken)
    ));
    assert!(
        store
            .create_step(StepInput {
                tournament_id: Uuid::new_v4(),
                definition: step_definition(1, 1, 4, 2),
            })
            .await
            .unwrap()
            .is_none()
    );
    let listed = store.list_steps(tournament.id).await.unwrap();
    assert_eq!(
        listed.iter().map(|s| s.position).collect::<Vec<_>>(),
        [1, 2]
    );
    let replaced = store
        .replace_step(last.id, step_definition(2, 1, 3, 1))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(replaced.group_size, 3);
    assert!(matches!(
        store
            .replace_step(last.id, step_definition(1, 1, 3, 1))
            .await,
        Err(StoreError::StepPositionTaken)
    ));

    // Lancement : groupes et participants créés avec l'étape, une seule fois.
    let started = store
        .start_step(StepStart {
            step_id: first.id,
            groups: vec![players.clone()],
        })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(started.status, StepStatus::Ongoing);
    assert!(matches!(
        store
            .start_step(StepStart {
                step_id: first.id,
                groups: vec![players.clone()],
            })
            .await,
        Err(StoreError::StepState)
    ));
    assert!(
        store
            .start_step(StepStart {
                step_id: Uuid::new_v4(),
                groups: vec![],
            })
            .await
            .unwrap()
            .is_none()
    );
    let groups = store.list_step_groups(first.id).await.unwrap();
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].index, 1);
    let members = store.list_step_participants(first.id).await.unwrap();
    assert_eq!(members.len(), 4);
    assert!(
        members
            .iter()
            .all(|m| m.points == 0.0 && m.final_rank.is_none())
    );

    assert!(
        store
            .set_step_points(first.id, players[0], 12.5)
            .await
            .unwrap()
    );
    assert!(
        !store
            .set_step_points(first.id, Uuid::new_v4(), 1.0)
            .await
            .unwrap()
    );
    assert_eq!(
        store
            .participant_points(tournament.id)
            .await
            .unwrap()
            .get(&players[0]),
        Some(&12.5)
    );

    // Clôture : l'étape suivante s'ouvre avec les deux qualifiés, dans la même transaction.
    let outcomes: Vec<StepOutcome> = players
        .iter()
        .zip(1..)
        .map(|(id, rank)| StepOutcome {
            participant_id: *id,
            final_rank: rank,
            status: if rank <= 2 {
                StepParticipantStatus::Qualified
            } else {
                StepParticipantStatus::Eliminated
            },
        })
        .collect();
    // Un inscrit étranger au tournoi fait échouer l'ouverture : rien ne change.
    assert!(
        store
            .close_step(StepClosing {
                step_id: first.id,
                outcomes: outcomes.clone(),
                next: Some(StepStart {
                    step_id: last.id,
                    groups: vec![vec![Uuid::new_v4()]],
                }),
            })
            .await
            .is_err()
    );
    assert_eq!(
        store.find_step(first.id).await.unwrap().unwrap().status,
        StepStatus::Ongoing
    );
    assert!(store.list_step_groups(last.id).await.unwrap().is_empty());

    let finished = store
        .close_step(StepClosing {
            step_id: first.id,
            outcomes,
            next: Some(StepStart {
                step_id: last.id,
                groups: vec![vec![players[0], players[1]]],
            }),
        })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(finished.status, StepStatus::Finished);
    assert_eq!(
        store.find_step(last.id).await.unwrap().unwrap().status,
        StepStatus::Ongoing
    );
    let members = store.list_step_participants(first.id).await.unwrap();
    assert_eq!(
        members
            .iter()
            .filter(|m| m.status == StepParticipantStatus::Qualified)
            .count(),
        2
    );
    assert!(members.iter().all(|m| m.final_rank.is_some()));
    assert_eq!(
        store.list_step_participants(last.id).await.unwrap().len(),
        2
    );
    assert!(matches!(
        store
            .close_step(StepClosing {
                step_id: first.id,
                outcomes: vec![],
                next: None,
            })
            .await,
        Err(StoreError::StepState)
    ));

    // Retirer un inscrit retire sa participation aux étapes ; supprimer une étape, ses groupes.
    assert!(store.delete_participant(players[3]).await.unwrap());
    assert_eq!(
        store.list_step_participants(first.id).await.unwrap().len(),
        3
    );
    assert!(store.delete_step(last.id).await.unwrap());
    assert!(!store.delete_step(last.id).await.unwrap());
    assert!(
        store
            .list_step_participants(last.id)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(store.delete_tournament(tournament.id).await.unwrap());
    assert!(store.find_step(first.id).await.unwrap().is_none());
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn steps_export_and_reimport_into_another_tournament() {
    let store = Arc::new(store().await);
    let game_id = game(&store).await;
    let new_tournament = || {
        store.create_tournament(TournamentInput {
            max_participants: 4,
            ..tournament_input(game_id)
        })
    };
    let (source, copy) = (
        new_tournament().await.unwrap(),
        new_tournament().await.unwrap(),
    );
    let mut users = Vec::new();
    for name in ["a", "b", "c", "d"] {
        users.push(user(&store, name).await);
    }
    let enroll = |tournament: Uuid, user_id: Uuid| {
        let store = store.clone();
        async move {
            store
                .add_participant(ParticipantInput {
                    tournament_id: tournament,
                    user_id: Some(user_id),
                    tournament_team_id: None,
                })
                .await
                .unwrap()
                .unwrap()
                .id
        }
    };
    let mut players = Vec::new();
    for user_id in &users {
        players.push(enroll(source.id, *user_id).await);
        enroll(copy.id, *user_id).await;
    }
    let create = |position: i32, size: i32, advance: i32| {
        store.create_step(StepInput {
            tournament_id: source.id,
            definition: step_definition(position, 1, size, advance),
        })
    };
    let first = create(1, 4, 2).await.unwrap().unwrap();
    let last = create(2, 2, 1).await.unwrap().unwrap();
    store
        .start_step(StepStart {
            step_id: first.id,
            groups: vec![players.clone()],
        })
        .await
        .unwrap();
    for (player, points) in players.iter().zip([9.0, 7.5, 4.0, 1.0]) {
        store
            .set_step_points(first.id, *player, points)
            .await
            .unwrap();
    }
    let outcomes = players
        .iter()
        .zip(1..)
        .map(|(id, rank)| StepOutcome {
            participant_id: *id,
            final_rank: rank,
            status: if rank <= 2 {
                StepParticipantStatus::Qualified
            } else {
                StepParticipantStatus::Eliminated
            },
        })
        .collect();
    store
        .close_step(StepClosing {
            step_id: first.id,
            outcomes,
            next: Some(StepStart {
                step_id: last.id,
                groups: vec![vec![players[0], players[1]]],
            }),
        })
        .await
        .unwrap();

    // Deux matchs dans la finale : un terminé, un qui attend ses participants.
    let group = store.list_step_groups(last.id).await.unwrap()[0].id;
    let created = |round: i32, participants: Vec<Uuid>| {
        store.create_match(MatchInput {
            game_id,
            step_id: last.id,
            group_id: group,
            round: Some(round),
            bracket: None,
            next_match_id: None,
            scheduled_at: Some("2026-11-14T18:00:00.000000Z".to_string()),
            participants,
        })
    };
    let played = created(1, vec![players[0], players[1]]).await.unwrap();
    created(2, vec![players[1]]).await.unwrap();
    store
        .finish_match(MatchFinish {
            match_id: played.id,
            scores: vec![
                MatchScore {
                    participant_id: players[0],
                    stats: serde_json::json!({}),
                    points: 2.5,
                    rank: Some(1),
                    result: Some(MatchResult::Win),
                },
                MatchScore {
                    participant_id: players[1],
                    stats: serde_json::json!({}),
                    points: 1.0,
                    rank: Some(2),
                    result: Some(MatchResult::Loss),
                },
            ],
            advance: None,
            step_points: vec![(players[0], 2.5), (players[1], 1.0)],
        })
        .await
        .unwrap();

    let steps = StoreSteps::new(store.clone());
    let exported = steps.export_in(source.id, &[]).await.unwrap();
    assert_eq!(exported.len(), 2);
    let items: Vec<serde_json::Value> = exported.iter().map(|(_, item)| item.clone()).collect();
    assert_eq!(items[0]["status"], "finished");
    assert_eq!(items[1]["status"], "ongoing");
    let matches = items[1]["matches"].as_array().unwrap();
    assert_eq!(matches.len(), 2);
    assert_eq!(matches[0]["status"], "finished");
    assert_eq!(matches[0]["participants"][0]["points"], 2.5);
    assert_eq!(matches[1]["status"], "scheduled");

    let mut scope = FileScope::default();
    for user_id in &users {
        let profile = store.find_profile(*user_id).await.unwrap().unwrap();
        scope.users.insert(profile.username.to_lowercase());
    }
    assert_eq!(
        steps.validate_in(game_id, &items, &scope).await.unwrap(),
        None
    );
    steps.import_in(copy.id, items.clone(), &[]).await.unwrap();
    let again: Vec<serde_json::Value> = steps
        .export_in(copy.id, &[])
        .await
        .unwrap()
        .into_iter()
        .map(|(_, item)| item)
        .collect();
    assert_eq!(again, items);

    // Réimporter remplace aussi les matchs de l'étape.
    let copied_last = store.list_steps(copy.id).await.unwrap()[1].id;
    assert_eq!(
        store
            .list_matches(copied_last, None, None)
            .await
            .unwrap()
            .len(),
        2
    );
    steps.import_in(copy.id, items.clone(), &[]).await.unwrap();
    let copied_last = store.list_steps(copy.id).await.unwrap()[1].id;
    assert_eq!(
        store
            .list_matches(copied_last, None, None)
            .await
            .unwrap()
            .len(),
        2
    );

    // Réimporter remplace : les étapes de la copie repartent du fichier.
    steps
        .import_in(copy.id, vec![items[0].clone()], &[])
        .await
        .unwrap();
    assert_eq!(store.list_steps(copy.id).await.unwrap().len(), 1);
    let totals = store.participant_points(copy.id).await.unwrap();
    assert_eq!(totals.values().copied().fold(0.0, f64::max), 9.0);
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn match_tables_enforce_their_constraints() {
    let store = store().await;
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    let game_id = game(&store).await;
    let alice = user(&store, "alice").await;
    let tournament = store
        .create_tournament(tournament_input(game_id))
        .await
        .unwrap();
    let other = store
        .create_tournament(tournament_input(game_id))
        .await
        .unwrap();
    let participant = store
        .add_participant(ParticipantInput {
            tournament_id: tournament.id,
            user_id: Some(alice),
            tournament_team_id: None,
        })
        .await
        .unwrap()
        .unwrap();
    let step = |tournament: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, Uuid>(
                "INSERT INTO step (tournament_id, position, format, match_type, group_count, \
                 group_size, matches_per_group, advance_per_group) \
                 VALUES ($1, 1, 'pool', 'ffa', 1, 4, 3, 2) RETURNING id",
            )
            .bind(tournament)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    let step_id = step(tournament.id).await;
    let other_step = step(other.id).await;
    let group = |step: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, Uuid>(
                "INSERT INTO step_group (step_id, index) VALUES ($1, 1) RETURNING id",
            )
            .bind(step)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    let group_id = group(step_id).await;

    let insert = |step: Option<Uuid>, group: Option<Uuid>, bracket: Option<&str>, status: &str| {
        let pool = pool.clone();
        let bracket = bracket.map(str::to_string);
        let status = status.to_string();
        async move {
            sqlx::query_scalar::<_, Uuid>(
                "INSERT INTO match (game_id, step_id, group_id, round, bracket, status) \
                 VALUES ($1, $2, $3, 1, $4, $5) RETURNING id",
            )
            .bind(game_id)
            .bind(step)
            .bind(group)
            .bind(bracket)
            .bind(status)
            .fetch_one(&pool)
            .await
        }
    };
    let match_id = insert(Some(step_id), Some(group_id), Some("winners"), "scheduled")
        .await
        .unwrap();
    // Un match hors tournoi n'a ni groupe ni tableau ; le groupe est celui de l'étape ; tableau
    // et statut connus.
    insert(None, None, None, "scheduled").await.unwrap();
    assert!(
        insert(None, Some(group_id), None, "scheduled")
            .await
            .is_err()
    );
    assert!(
        insert(None, None, Some("winners"), "scheduled")
            .await
            .is_err()
    );
    assert!(
        insert(Some(other_step), Some(group_id), None, "scheduled")
            .await
            .is_err()
    );
    assert!(
        insert(Some(step_id), Some(group_id), Some("upper"), "scheduled")
            .await
            .is_err()
    );
    assert!(
        insert(Some(step_id), Some(group_id), None, "postponed")
            .await
            .is_err()
    );

    // Le vainqueur va dans un autre match, jamais dans le même ; supprimer le suivant détache.
    let next = insert(Some(step_id), Some(group_id), Some("winners"), "scheduled")
        .await
        .unwrap();
    assert!(
        sqlx::query("UPDATE match SET next_match_id = id WHERE id = $1")
            .bind(match_id)
            .execute(&pool)
            .await
            .is_err()
    );
    sqlx::query("UPDATE match SET next_match_id = $2 WHERE id = $1")
        .bind(match_id)
        .bind(next)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        sqlx::query(
            "UPDATE match SET started_at = now(), ended_at = now() - interval '1 hour' WHERE id = $1"
        )
        .bind(match_id)
        .execute(&pool)
            .await
            .is_err()
    );

    let enroll = |match_id: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query("INSERT INTO match_participant (match_id, participant_id) VALUES ($1, $2)")
                .bind(match_id)
                .bind(participant.id)
                .execute(&pool)
                .await
        }
    };
    enroll(match_id).await.unwrap();
    assert!(enroll(match_id).await.is_err());
    let (stats, points): (serde_json::Value, f64) =
        sqlx::query_as("SELECT stats, points::float8 FROM match_participant WHERE match_id = $1")
            .bind(match_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((stats, points), (serde_json::json!({}), 0.0));
    for bad in [
        "UPDATE match_participant SET stats = '[1]'::jsonb WHERE match_id = $1",
        "UPDATE match_participant SET rank = 0 WHERE match_id = $1",
        "UPDATE match_participant SET result = 'forfeit' WHERE match_id = $1",
    ] {
        let attempt = sqlx::query(bad).bind(match_id).execute(&pool).await;
        assert!(attempt.is_err(), "{bad}");
    }
    sqlx::query(
        "UPDATE match_participant SET stats = '{\"placement\": 2, \"kills\": 7}', \
         rank = 2, result = 'loss' WHERE match_id = $1",
    )
    .bind(match_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("DELETE FROM match WHERE id = $1")
        .bind(next)
        .execute(&pool)
        .await
        .unwrap();
    let detached: Option<Uuid> =
        sqlx::query_scalar("SELECT next_match_id FROM match WHERE id = $1")
            .bind(match_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(detached, None);

    // Supprimer le tournoi emporte ses étapes, leurs matchs et leurs participants.
    sqlx::query("DELETE FROM tournaments WHERE id = $1")
        .bind(tournament.id)
        .execute(&pool)
        .await
        .unwrap();
    let left: i64 = sqlx::query_scalar(
        "SELECT (SELECT count(*) FROM match WHERE id = $1) \
         + (SELECT count(*) FROM match_participant WHERE match_id = $1)",
    )
    .bind(match_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(left, 0);
}

#[tokio::test]
#[ignore = "nécessite PostgreSQL migré (DATABASE_URL)"]
async fn matches_are_stored_scored_and_finished_atomically() {
    let store = store().await;
    let game_id = game(&store).await;
    let tournament = store
        .create_tournament(TournamentInput {
            max_participants: 4,
            ..tournament_input(game_id)
        })
        .await
        .unwrap();
    let mut players = Vec::new();
    for name in ["a", "b", "c", "d"] {
        let user_id = user(&store, name).await;
        let participant = store
            .add_participant(ParticipantInput {
                tournament_id: tournament.id,
                user_id: Some(user_id),
                tournament_team_id: None,
            })
            .await
            .unwrap();
        players.push(participant.unwrap().id);
    }
    let step = store
        .create_step(StepInput {
            tournament_id: tournament.id,
            definition: StepDefinition {
                format: StepFormat::SingleElim,
                match_type: MatchType::Duel,
                ..step_definition(1, 1, 4, 1)
            },
        })
        .await
        .unwrap()
        .unwrap();
    store
        .start_step(StepStart {
            step_id: step.id,
            groups: vec![players.clone()],
        })
        .await
        .unwrap();
    let group = store.list_step_groups(step.id).await.unwrap()[0].id;
    let input = |round: i32, next: Option<Uuid>, participants: Vec<Uuid>| MatchInput {
        game_id,
        step_id: step.id,
        group_id: group,
        round: Some(round),
        bracket: None,
        next_match_id: next,
        scheduled_at: Some("2026-11-14T18:00:00.000000Z".to_string()),
        participants,
    };

    let last = store.create_match(input(2, None, vec![])).await.unwrap();
    let semi = store
        .create_match(input(1, Some(last.id), vec![players[0], players[1]]))
        .await
        .unwrap();
    assert_eq!(semi.status, MatchStatus::Scheduled);
    assert_eq!(semi.step_id, Some(step.id));
    assert_eq!(
        semi.scheduled_at.as_deref(),
        Some("2026-11-14T18:00:00.000000Z")
    );
    let listed = store.list_matches(step.id, None, None).await.unwrap();
    assert_eq!(
        listed.iter().map(|m| m.round).collect::<Vec<_>>(),
        [Some(1), Some(2)]
    );
    assert_eq!(
        store
            .list_matches(step.id, Some(group), Some(MatchStatus::Finished))
            .await
            .unwrap(),
        []
    );
    assert_eq!(store.find_match(semi.id).await.unwrap(), Some(semi.clone()));

    // Modification partielle : `Some(None)` efface, les participants gardent leurs résultats.
    let updated = store
        .update_match(
            semi.id,
            MatchUpdate {
                round: Some(None),
                bracket: Some(Some(Bracket::Winners)),
                scheduled_at: Some(None),
                participants: Some(vec![players[0], players[2]]),
                ..MatchUpdate::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (updated.round, updated.bracket, updated.scheduled_at),
        (None, Some(Bracket::Winners), None)
    );
    assert_eq!(updated.next_match_id, Some(last.id));
    store
        .update_match(
            semi.id,
            MatchUpdate {
                round: Some(Some(1)),
                participants: Some(vec![players[0], players[1]]),
                ..MatchUpdate::default()
            },
        )
        .await
        .unwrap();
    let members = store.list_step_match_participants(step.id).await.unwrap();
    let in_semi: Vec<Uuid> = members
        .iter()
        .filter(|p| p.match_id == semi.id)
        .map(|p| p.participant_id)
        .collect();
    assert_eq!(in_semi.len(), 2);
    assert!(in_semi.contains(&players[0]) && in_semi.contains(&players[1]));
    assert!(
        store
            .update_match(Uuid::new_v4(), MatchUpdate::default())
            .await
            .unwrap()
            .is_none()
    );

    // Résultats : statistiques jsonb, points décimaux, rang et résultat.
    let score = |participant_id: Uuid, kills: u32, points: f64, rank: i32, result| MatchScore {
        participant_id,
        stats: serde_json::json!({ "kills": kills }),
        points,
        rank: Some(rank),
        result: Some(result),
    };
    let scores = vec![
        score(players[0], 3, 4.5, 1, MatchResult::Win),
        score(players[1], 1, 1.5, 2, MatchResult::Loss),
    ];
    assert!(
        store
            .save_match_scores(semi.id, scores.clone())
            .await
            .unwrap()
    );
    assert!(
        !store
            .save_match_scores(Uuid::new_v4(), scores.clone())
            .await
            .unwrap()
    );
    let saved = store.list_step_match_participants(step.id).await.unwrap();
    let winner = saved
        .iter()
        .find(|p| p.participant_id == players[0] && p.match_id == semi.id)
        .unwrap();
    assert_eq!(winner.stats, serde_json::json!({ "kills": 3 }));
    assert_eq!((winner.points, winner.rank), (4.5, Some(1)));
    assert_eq!(winner.result, Some(MatchResult::Win));

    let ongoing = store
        .set_match_status(semi.id, MatchStatus::Ongoing)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(ongoing.status, MatchStatus::Ongoing);
    assert!(ongoing.started_at.is_some());
    assert!(
        store
            .set_match_status(Uuid::new_v4(), MatchStatus::Ongoing)
            .await
            .unwrap()
            .is_none()
    );

    // Clôture : résultats, vainqueur dans le match suivant et points de l'étape, ensemble.
    let finished = store
        .finish_match(MatchFinish {
            match_id: semi.id,
            scores,
            advance: Some((last.id, players[0])),
            step_points: vec![(players[0], 4.5), (players[1], 1.5)],
        })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(finished.status, MatchStatus::Finished);
    assert!(finished.ended_at.is_some());
    let in_last: Vec<Uuid> = store
        .list_step_match_participants(step.id)
        .await
        .unwrap()
        .into_iter()
        .filter(|p| p.match_id == last.id)
        .map(|p| p.participant_id)
        .collect();
    assert_eq!(in_last, [players[0]]);
    let totals: Vec<f64> = store
        .list_step_participants(step.id)
        .await
        .unwrap()
        .into_iter()
        .filter(|m| m.participant_id == players[0] || m.participant_id == players[1])
        .map(|m| m.points)
        .collect();
    assert_eq!(totals.iter().sum::<f64>(), 6.0);
    for attempt in [
        store
            .finish_match(MatchFinish {
                match_id: semi.id,
                scores: vec![],
                advance: None,
                step_points: vec![],
            })
            .await
            .map(|_| ()),
        store
            .set_match_status(semi.id, MatchStatus::Cancelled)
            .await
            .map(|_| ()),
        store.save_match_scores(semi.id, vec![]).await.map(|_| ()),
    ] {
        assert!(matches!(attempt, Err(StoreError::MatchState)));
    }

    // Un match annulé garde sa date de fin ; supprimer le suivant détache le précédent.
    let cancelled = store
        .set_match_status(last.id, MatchStatus::Cancelled)
        .await
        .unwrap()
        .unwrap();
    assert!(cancelled.ended_at.is_some());
    assert!(store.delete_match(last.id).await.unwrap());
    assert!(!store.delete_match(last.id).await.unwrap());
    assert_eq!(
        store
            .find_match(semi.id)
            .await
            .unwrap()
            .unwrap()
            .next_match_id,
        None
    );

    // Retirer un inscrit retire sa participation aux matchs, pas les matchs.
    assert!(store.delete_participant(players[0]).await.unwrap());
    assert!(store.find_match(semi.id).await.unwrap().is_some());
    let remaining = store.list_step_match_participants(step.id).await.unwrap();
    assert!(remaining.iter().all(|p| p.participant_id != players[0]));

    // Supprimer le tournoi emporte ses étapes, leurs matchs et leurs participants.
    assert!(store.delete_tournament(tournament.id).await.unwrap());
    assert_eq!(store.find_match(semi.id).await.unwrap(), None);
    assert!(
        store
            .list_step_match_participants(step.id)
            .await
            .unwrap()
            .is_empty()
    );
}
