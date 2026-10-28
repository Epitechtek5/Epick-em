# API publique — authentification

Référence des routes de `api-public` (décisions : [ADR-009](adr/009-authentification-jwt-et-roles.md)). Les routes sont exposées sans préfixe ; le front les appelle en `/api/*` et nginx (ou le proxy Vite) retire le préfixe.

## Documentation OpenAPI

Swagger UI est servi sur `/docs` (`/api/docs/` via nginx ou Vite) et la spécification sur `/openapi.json`, sans authentification. Pour ajouter un endpoint : annoter le handler avec `#[utoipa::path]`, puis l'enregistrer avec `routes!(handler)` dans le `routes()` de son module (détails en tête de `openapi.rs`). Les types TS du web et du mobile en sont générés, voir [`openapi/README.md`](../openapi/README.md).

## Routes

| Route | Authentification | Corps | Réponse |
|---|---|---|---|
| `GET /health` | aucune | — | `200` `ok` |
| `GET /hello` | aucune | — | `200` `Hello, world!` |
| `POST /register` | aucune | `{ username, password, email? }` | `201` `{ id, username }` |
| `POST /login` | aucune | `{ username, password }` | `200` jetons (voir ci-dessous) |
| `POST /refresh` | JWT, **expiré toléré** | `{ refresh_token }` | `200` nouveaux jetons |
| `POST /logout` | JWT valide | `{ refresh_token }` | `204` |
| `POST /forgot-password` | aucune | `{ email }` | `204` (toujours, voir ci-dessous) |
| `POST /reset-password` | aucune | `{ token, password }` | `204` |
| `GET /users` | JWT valide | `?limit` (1 à 100, 50 par défaut), `?offset` | `200` `[{ id, username, role }]` |
| `GET /user/{id}` | JWT valide | — | `200` `{ id, username, role }` |
| `PATCH /user/{id}/update` | JWT valide, **administrateur** | `{ username?, password?, role?, email? }` | `200` `{ id, username, role }` |
| `DELETE /user/{id}/delete` | JWT valide, **administrateur** | — | `204` |
| `PATCH /me/update` | JWT valide | `{ username?, password?, email? }` (`role` refusé) | `200` `{ id, username, role }` |
| `DELETE /me/delete` | JWT valide | — | `204` |
| toute autre route | JWT valide | — | — |

L'authentification se fait par `Authorization: Bearer <access_token>`.

### Réponse de `/login` et `/refresh`

```json
{
  "access_token": "<JWT>",
  "refresh_token": "<64 caractères hexadécimaux>",
  "token_type": "Bearer",
  "expires_in": 900
}
```

Le jeton d'accès est un JWT HS256 dont les claims sont `sub` (id du compte), `username`, `role` (`user`, `admin` ou `watcher`), `iat` et `exp`.

### Règles

- **Inscription :** nom de 3 à 32 caractères (lettres, chiffres, `_`, `.`, `-`), unique sans tenir compte de la casse ; mot de passe de 8 à 128 caractères. Le compte créé a le rôle `user`.
- **`/refresh`** : le jeton de rafraîchissement est à usage unique (il est remplacé à chaque appel) et doit appartenir au compte du JWT. Le rôle est relu en base.
- **`/logout`** : révoque le jeton de rafraîchissement, s'il appartient au compte du JWT. Idempotent : `204` même si le jeton est inconnu, déjà révoqué ou d'un autre compte (dans ce dernier cas il n'est pas révoqué). Le jeton d'accès reste valable jusqu'à son expiration.

- **Mot de passe oublié :** l'adresse e-mail est facultative, unique sans tenir compte de la casse, et stockée en minuscules ; elle se renseigne à l'inscription ou avec `PATCH /me/update`. `/forgot-password` envoie par Resend un lien `PASSWORD_RESET_URL?token=<jeton>` et répond `204` que l'adresse corresponde à un compte ou non (pas d'énumération des comptes ; seule une adresse mal formée donne `400`). Le jeton (256 bits d'aléa, empreinte SHA-256 en base) est à usage unique et valable une heure ; une nouvelle demande invalide les précédentes. `/reset-password` change le mot de passe (mêmes règles qu'à l'inscription) et révoque tous les jetons de rafraîchissement du compte ; un jeton inconnu, expiré ou déjà utilisé donne `400 invalid_reset_token`. Une panne de Resend est journalisée sans changer la réponse.

### Erreurs

Format `{ "error", "message", "errors"? }` :

| Statut | `error` | Cas |
|---|---|---|
| `400` | `invalid_request` | corps illisible ou champs invalides (`errors` donne le détail par champ) |
| `401` | `unauthorized` | jeton absent, invalide ou expiré ; identifiants ou jeton de rafraîchissement refusés |
| `403` | `forbidden` | action réservée aux administrateurs, ou changement de son propre rôle |
| `404` | `not_found` | compte introuvable (ou identifiant qui n'est pas un UUID) |
| `400` | `invalid_reset_token` | lien de réinitialisation inconnu, expiré ou déjà utilisé |
| `409` | `username_taken` | nom d'utilisateur déjà pris |
| `409` | `email_taken` | adresse e-mail déjà utilisée |
| `500` | `internal` | erreur serveur (détail journalisé, jamais renvoyé) |

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `JWT_SECRET` | — (obligatoire, 32 caractères minimum) | clé de signature des jetons d'accès |
| `ACCESS_TOKEN_TTL_SECS` | `900` | durée du jeton d'accès |
| `REFRESH_TOKEN_TTL_SECS` | `2592000` | durée du jeton de rafraîchissement |
| `RESEND_API_KEY` | — (facultative) | clé d'API [Resend](https://resend.com) ; sans elle, aucun e-mail n'est envoyé (un avertissement est journalisé au démarrage) |
| `MAIL_FROM` | `Epick'em <onboarding@resend.dev>` | expéditeur, sur un domaine vérifié chez Resend en production |
| `PASSWORD_RESET_URL` | `http://localhost:3000/reset-password` | début du lien envoyé par e-mail (page web, ou lien profond du mobile) |

## Rôles

Les inscriptions créent des `user`. Les rôles sont `user`, `admin` et `watcher`. Un administrateur change le rôle d'un compte avec `PATCH /user/{id}/update` ; le premier administrateur se désigne en base :

```sql
UPDATE users SET role = 'admin' WHERE lower(username) = lower('<nom>');
```

Le changement apparaît dans le jeton d'accès au prochain `/refresh` ou `/login`. Les routes réservées aux administrateurs ne se fient pas au claim `role` (qui peut dater de `ACCESS_TOKEN_TTL_SECS`) : elles relisent le rôle courant en base (hors cache), si bien qu'un administrateur rétrogradé ou supprimé perd ses droits immédiatement. Le framework est actix-web ([ADR-010](adr/010-api-publique-actix-web.md)).
