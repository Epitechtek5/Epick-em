# ADR-009 — Authentification par JWT d'accès, jeton de rafraîchissement opaque et rôles

- **Statut :** Proposé
- **Date :** 2026-10-26
- **Décideurs :** équipe backend
- **Issue liée :** #13, #15

## Contexte

L'API publique (ADR-002) sert le front web et le mobile. Il faut inscrire et connecter des utilisateurs, protéger les routes, permettre de rester connecté sans stocker de mot de passe côté client, et distinguer à terme les administrateurs des joueurs.

Contraintes :

- les requêtes authentifiées sont nombreuses (milliers de spectateurs, ADR-008) : vérifier un jeton ne doit pas coûter une requête SQL ;
- une fuite de la base ne doit donner ni mot de passe ni jeton utilisable ;
- le front garde les jetons en mémoire (pas de `localStorage`) : un jeton d'accès doit pouvoir expirer vite et être renouvelé sans reconnexion.

## Options étudiées

### Option A — Sessions côté serveur (identifiant opaque en base ou dans Redis)
- ✅ Révocation immédiate.
- ❌ Un accès base ou Redis par requête ; état partagé entre instances.

### Option B — JWT unique de longue durée
- ✅ Aucun état serveur.
- ❌ Impossible à révoquer ; un jeton volé reste valable longtemps.

### Option C — JWT d'accès de courte durée + jeton de rafraîchissement opaque, stocké haché et à usage unique
- ✅ Vérification d'une requête sans état (signature et expiration).
- ✅ La déconnexion révoque le jeton de rafraîchissement ; un jeton volé n'est utile que peu de temps.
- ❌ Le jeton d'accès reste valable jusqu'à son expiration après une déconnexion.

## Décision

**Nous retenons l'option C.**

- **Mots de passe :** hachés avec Argon2id. Un compte inconnu et un mauvais mot de passe sont indiscernables (même réponse, même durée).
- **Jeton d'accès :** JWT HS256 signé avec `JWT_SECRET`, valable `ACCESS_TOKEN_TTL_SECS` (15 min par défaut). Claims : `sub` (id du compte), `username`, `role`, `iat`, `exp`. Transmis par `Authorization: Bearer`.
- **Jeton de rafraîchissement :** 256 bits aléatoires, valable `REFRESH_TOKEN_TTL_SECS` (30 jours par défaut). Seule l'empreinte SHA-256 est stockée (`refresh_tokens`). **Usage unique** : chaque `/refresh` le remplace. Il est lié à un compte : il n'est utilisable et révocable que par le titulaire du JWT.
- **Middleware :** toutes les routes exigent un jeton d'accès valide, **sauf** `/register`, `/login`, `/health` et `/hello`. Une nouvelle route est donc protégée par défaut ; la liste des routes publiques est dans `route_policy` (`api-public/src/guard.rs`). `/refresh` accepte un jeton d'accès expiré (signature valide) : c'est son rôle. `/logout` exige un jeton valide.
- **Rôles :** colonne `users.role` (`user` par défaut, `admin` ou `watcher`), reprise dans le claim `role`. Toute inscription crée un `user` ; un `admin` se désigne en base, ou via `PATCH /user/{id}/update` par un administrateur. Le rôle est relu en base à chaque rafraîchissement.

## Conséquences

- **Positives :** requêtes authentifiées sans accès base ; fuite de la table des jetons sans conséquence ; rotation qui détecte le rejeu d'un jeton de rafraîchissement.
- **Négatives / coûts acceptés :** après une déconnexion, le jeton d'accès reste valable jusqu'à 15 min ; une promotion ou une rétrogradation ne s'applique qu'au prochain rafraîchissement ; pas de révocation immédiate d'un compte.
- **Actions à mener :** ajouter un contrôle de rôle (layer ou extracteur « admin requis ») dès qu'une route réservée aux administrateurs existe ; prévoir un moyen de créer le premier administrateur autrement que par SQL.

Voir [la référence des routes](../api-public.md).
