# Pronostics et Pick'em

Les spectateurs pronostiquent les matchs et répondent au Pick'em d'un tournoi ; la résolution
leur attribue des points, additionnés dans les classements. Routes et règles :
`docs/api-public.md` (« Pronostics et Pick'em »).

## Où vit quoi

| Élément | Emplacement |
|---|---|
| Notation pure (issues, points, égalités) | `domain::pickem` |
| Tables `prediction`, `pickem_question`, `pickem_answer`, `pickem_resolution` | `db/changelog/0019-predictions-pickem.yaml` |
| Persistance | `api-public/src/store/pickem*.rs` (trait `PickemStore`, en mémoire et PostgreSQL) |
| Routes | `api-public/src/predictions.rs`, `api-public/src/pickem.rs` |
| Résolution | `api-public/src/resolution.rs`, lancée par api-internal à chaque changement d'un tournoi (bus Redis, `docs/temps-reel.md`) et à intervalle régulier (`RESOLVE_INTERVAL_SECS`) |

Les pronostics sont des données d'Epick'em : ils sont en base même pour un tournoi importé,
dont les matchs et les inscrits vivent dans Redis (`docs/connecteurs.md`). `match_id` et les
inscrits choisis n'ont donc pas de clé étrangère ; leurs identifiants importés sont stables
(UUID v5), si bien qu'un pronostic reste valable après une resynchronisation ou une
reconstruction de Redis.

## Résolution

`resolve_tournament` relit l'état (matchs et participants de chaque étape, inscrits et rangs
finaux des étapes, points du tournoi), recalcule l'issue et les points de **chaque** pronostic
et de **chaque** réponse, puis n'écrit que ce qui change. C'est ce qui la rend idempotente
(ADR-002, règle 2) et qui reprend toute correction de résultat au passage suivant, sans
événement dédié. api-internal la lance sur les tournois non réglés, les moins récemment résolus
d'abord ; un tournoi local terminé dont tout est tranché est marqué réglé et n'est plus relu.

## Ajouter un modèle de question

1. **Nom :** ajouter la variante à `QuestionKind` (`store/pickem.rs`) et au test
   `enums_round_trip_through_their_database_text`. La colonne `kind` est un `varchar(32)` :
   aucune migration.
2. **Disponibilité :** dans `pickem::templates`, dire quand le modèle est proposé et pourquoi il
   ne l'est pas (`reason`). Ne proposer que ce qui est **résoluble** avec les données du tournoi :
   un tournoi importé n'a ni barème ni statistiques, et ses capacités dépendent de la source
   (`Capabilities`, ADR-003).
3. **Réglages :** si le modèle en a (comme `step_id`), les valider dans `create_question` et les
   ranger dans `params`.
4. **Réponse attendue :** choix unique (`participant_id`) ou multiple (`participant_ids`, borné
   par `expected_of`) dans `answer_question`.
5. **Bonne réponse :** dans `resolution::question_answers`, renvoyer `None` tant que la question
   n'est pas tranchée, `Some(vec![])` si elle ne pourra pas l'être (elle devient `void`), sinon les
   bonnes réponses (plusieurs en cas d'égalité) et le nombre attendu.
6. **Notation :** `resolution::score_answer` choisit `score_pick` ou `score_set` ; une notation
   nouvelle s'ajoute à `domain::pickem`, avec ses tests.
7. **Points par défaut :** `pickem::default_points`.
8. **Tests :** un cas dans `tests/predictions.rs` (création refusée quand le modèle n'est pas
   résoluble, réponse, résolution, classement).

## Limites actuelles

- Les clients sont prévenus par WebSocket (`leaderboard.updated`, `predictions.updated`,
  `docs/temps-reel.md`) mais relisent eux-mêmes pronostics et classements.
- Pas de score exact pronostiqué : les matchs n'ont pas de score de manches dans ce modèle (les
  manches arrivent avec #185).
- Le classement général additionne tous les tournois, sans saison ni groupe privé.
