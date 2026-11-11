# loadtest

Scénarios de charge [k6](https://k6.io) (voir ADR-004). Un fichier `*.js` par scénario.

| Scénario | Ce qu'il mesure |
|---|---|
| `tournament-live.js` | spectateurs qui consultent un tournoi en cours pendant qu'un arbitre saisit des résultats : latence des lectures, de la fin d'un match, et délai avant que le classement reflète le résultat |

## Lancer

```bash
loadtest/run-local.sh                                          # 200 spectateurs, palier de 3 min
PEAK_VUS=500 DURATION=3m MATCHES_PER_GROUP=25 loadtest/run-local.sh
```

`run-local.sh` monte un environnement **isolé et jetable** (PostgreSQL et Redis en conteneurs,
migrations, api-public compilé en release sur un port dédié, comptes de test), lance k6 en
conteneur, écrit le résumé JSON dans `results/` puis supprime tout ce qu'il a créé. Il ne vise
jamais un environnement partagé ni la production.

Variables : `PEAK_VUS`, `DURATION`, `SPECTATORS` (comptes distincts), `LOAD_GROUPS` (poules de 8),
`MATCHES_PER_GROUP`, `RESULTS_RATE` (matchs terminés par seconde), `K6_IMAGE`, ports `PG_PORT`,
`REDIS_PORT`, `API_PORT`.

Résultats mesurés, seuils et limites : [`docs/exploitation/tests-de-charge.md`](../docs/exploitation/tests-de-charge.md).
