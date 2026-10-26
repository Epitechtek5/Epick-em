# API publique — authentification

Référence des routes de `api-public` (décisions : [ADR-009](adr/009-authentification-jwt-et-roles.md)). Les routes sont exposées sans préfixe ; le front les appelle en `/api/*` et nginx (ou le proxy Vite) retire le préfixe.

## Documentation OpenAPI

Swagger UI est servi sur `/docs` (`/api/docs/` via nginx ou Vite) et la spécification sur `/openapi.json`, sans authentification. Pour ajouter un endpoint : annoter le handler avec `#[utoipa::path]`, puis l'enregistrer avec `routes!(handler)` dans le `routes()` de son module (détails en tête de `openapi.rs`). Les types TS du web et du mobile en sont générés, voir [`openapi/README.md`](../openapi/README.md).

## Routes

| Route | Authentification | Corps | Réponse |
|---|---|---|---|
| `GET /health` | aucune | — | `200` `ok` |
| `GET /hello` | aucune | — | `200` `Hello, world!` |
| `POST /register` | aucune | `{ username, password }` | `201` `{ id, username }` |
| `POST /login` | aucune | `{ username, password }` | `200` jetons (voir ci-dessous) |
| `POST /refresh` | JWT, **expiré toléré** | `{ refresh_token }` | `200` nouveaux jetons |
| `POST /logout` | JWT valide | `{ refresh_token }` | `204` |
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

Le jeton d'accès est un JWT HS256 dont les claims sont `sub` (id du compte), `username`, `role` (`user` ou `admin`), `iat` et `exp`.

### Règles

- **Inscription :** nom de 3 à 32 caractères (lettres, chiffres, `_`, `.`, `-`), unique sans tenir compte de la casse ; mot de passe de 8 à 128 caractères. Le compte créé a le rôle `user`.
- **`/refresh`** : le jeton de rafraîchissement est à usage unique (il est remplacé à chaque appel) et doit appartenir au compte du JWT. Le rôle est relu en base.
- **`/logout`** : révoque le jeton de rafraîchissement, s'il appartient au compte du JWT. Idempotent : `204` même si le jeton est inconnu, déjà révoqué ou d'un autre compte (dans ce dernier cas il n'est pas révoqué). Le jeton d'accès reste valable jusqu'à son expiration.

### Erreurs

Format `{ "error", "message", "errors"? }` :

| Statut | `error` | Cas |
|---|---|---|
| `400` | `invalid_request` | corps illisible ou champs invalides (`errors` donne le détail par champ) |
| `401` | `unauthorized` | jeton absent, invalide ou expiré ; identifiants ou jeton de rafraîchissement refusés |
| `409` | `username_taken` | nom d'utilisateur déjà pris |
| `500` | `internal` | erreur serveur (détail journalisé, jamais renvoyé) |

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `JWT_SECRET` | — (obligatoire, 32 caractères minimum) | clé de signature des jetons d'accès |
| `ACCESS_TOKEN_TTL_SECS` | `900` | durée du jeton d'accès |
| `REFRESH_TOKEN_TTL_SECS` | `2592000` | durée du jeton de rafraîchissement |

## Rôles

Les inscriptions créent des `user`. Pour promouvoir un compte :

```sql
UPDATE users SET role = 'admin' WHERE lower(username) = lower('<nom>');
```

La promotion apparaît dans le jeton d'accès au prochain `/refresh` ou `/login`. Aucune route ne l'exige encore : le claim `role` est disponible dans les extensions de la requête (`Claims`) pour les futurs contrôles.
