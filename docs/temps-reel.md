# Temps réel : bus Redis et WebSocket

Mise en œuvre d'ADR-002 (`docs/adr/002-api-publique-interne-bus-redis.md`).

## Vue d'ensemble

```text
écriture API ─┐                                ┌─► api-internal : résolution des pronostics
              ├─► Redis Stream epickem:events ─┤      └─► leaderboard.updated
sync externe ─┘   (groupe api-internal, ack)   │
              └─► Redis Pub/Sub live.<sujet> ──┴─► chaque api-public ─► clients WebSocket
```

| Élément | Emplacement |
|---|---|
| Événements, messages temps réel, sujets | `domain::events` |
| Bus (traits, Redis, mémoire) | `infra::bus` |
| Publication après écriture, consommation du flux | `api-public/src/realtime.rs` |
| Changements venus d'une source externe | `api-public/src/projection.rs` (`StoreProjector::with_bus`) |
| WebSocket `GET /ws` | `api-public/src/ws.rs` |
| Consommateur | `api-internal/src/main.rs` |

## Événements métier (Redis Streams)

- Flux `epickem:events` (plafonné à ~100 000 entrées), champ `event` en JSON :
  `{"id", "occurred_at" (ms), "type": "tournament_changed" | "tournament_deleted", "tournament_id", …}`.
- Publiés par api-public après toute écriture **réussie** sous `/tournaments/{id}/…` (hors
  pronostics et Pick'em, qui ne changent pas les données du tournoi), et par la
  synchronisation quand un instantané **change** le tournoi importé.
- Consommés par api-internal dans le groupe `api-internal` (nom du consommateur : `HOSTNAME`).
  Un événement n'est acquitté qu'après traitement ; un événement livré mais non acquitté depuis
  60 s (instance tombée) est repris par un autre consommateur (`XAUTOCLAIM`). Rejouer un
  événement est sans effet : la résolution recalcule tout à partir de l'état.
- Une panne de Redis ne fait jamais échouer une requête : l'erreur est journalisée et la
  résolution périodique (`RESOLVE_INTERVAL_SECS`) rattrape le retard.

## Temps réel (Redis Pub/Sub)

Chaque instance d'api-public s'abonne à `live.*` et redistribue à ses clients WebSocket ; un
message publié par une instance (ou par api-internal) atteint donc tous les clients.

| Sujet | Événement | Quand |
|---|---|---|
| `tournament:<id>` | `tournament.updated` | données du tournoi modifiées (`data.cause` : `api` ou `external_sync`) |
| `tournament:<id>` | `tournament.deleted` | tournoi supprimé |
| `tournament:<id>` | `predictions.updated` | un spectateur a changé un pronostic (`data.match_id`) |
| `tournament:<id>`, `leaderboard` | `leaderboard.updated` | une résolution a changé des points |

Les messages ne portent que des identifiants : le client relit l'API (les droits restent ceux
de l'API REST).

## WebSocket `GET /ws`

Le jeton d'accès est envoyé dans le **premier message** (pas d'en-tête possible depuis un
navigateur, et un jeton dans l'URL finirait dans les journaux).

```text
→ {"type":"auth","token":"<access_token>"}          dans les 10 s, sinon fermeture 4001
← {"type":"ready","user_id":"…"}
→ {"type":"subscribe","topic":"tournament:<id>"}     ou "leaderboard" ; 50 sujets au plus
← {"type":"subscribed","topic":"…"}
← {"type":"event","topic":"…","event":"tournament.updated","data":{…}}
→ {"type":"unsubscribe","topic":"…"}  ← {"type":"unsubscribed","topic":"…"}
→ {"type":"ping"}                     ← {"type":"pong"}
← {"type":"error","message":"…"}                    message refusé, la connexion reste ouverte
← {"type":"resync"}                                 messages perdus : tout relire
```

- Les messages sont regroupés toutes les 250 ms et les doublons fusionnés (une rafale de
  résultats ne produit qu'un message par sujet et par type).
- Le serveur envoie un ping WebSocket toutes les 30 s et ferme la connexion sans nouvelle du
  client depuis 90 s.
- À l'expiration du jeton, la connexion est fermée avec le code `4001` (`token_expired`) : le
  client rafraîchit son jeton et se reconnecte, puis se réabonne.
- Messages client : texte JSON de 4 Kio au plus.

## Tests

- Mémoire : `cargo test -p api-public --test realtime` (publication, consommation, WebSocket).
- Redis : `REDIS_URL=redis://localhost:6379 cargo test -p infra --test bus -- --ignored`.
