# ADR-010 — `api-public` sur actix-web

- **Statut :** Proposé
- **Date :** 2026-10-26
- **Décideurs :** équipe backend
- **Issue liée :** #13, #15, #17

## Contexte

Deux implémentations de l'API publique ont été écrites en parallèle :

- l'authentification (ADR-009) et la documentation OpenAPI, sur **axum**, avec des identifiants `uuid` ;
- la gestion des comptes (consultation, modification, suppression), sur **actix-web**, avec des identifiants numériques, une table `roles` et le rôle `watcher`.

Les deux modifient la table `users` et exposent `/register` : elles ne peuvent pas coexister dans un même binaire.

## Décision

**`api-public` utilise actix-web.** L'authentification et la documentation OpenAPI sont conservées telles que décrites par l'ADR-009, portées sur actix-web :

- `guard::require_auth` devient un middleware actix (`middleware::from_fn`), avec la même `route_policy` (protégé par défaut) ;
- la spécification OpenAPI est produite avec `utoipa-actix-web`, et `cargo run --bin openapi` fonctionne comme avant ;
- les identifiants sont des `uuid` (colonne `users.id` de `0001-create-users`) ;
- trois rôles, `admin`, `user` et `watcher`, dans la colonne `users.role` (migration `0004-allow-watcher-role`) ; la table `roles` n'est pas reprise ;
- les profils lus passent par `infra::CachedDb` (ADR-008). Seul le profil public est mis en cache, jamais l'empreinte du mot de passe.

## Conséquences

- **Positives :** un seul framework et un seul modèle de comptes ; les routes de gestion des comptes sont protégées par le JWT au lieu de l'en-tête provisoire `X-User-Id`.
- **Négatives / coûts acceptés :** le code d'authentification a dû être réécrit pour actix-web (comportement et tests conservés).
- **Actions à mener :** aucune pour le moment ; les actions d'administration relisent le rôle courant plutôt que de se fier au claim, qui peut dater de 15 minutes.
