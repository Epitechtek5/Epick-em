# Epick'em

Plateforme de tournois et de pronostics (Pick'em) en temps réel.

## Démarrage rapide

Prérequis : Docker (avec Compose v2), et Rust stable pour lancer les tests hors conteneur.

```sh
git clone <url-du-dépôt> epickem && cd epickem
make up      # crée .env depuis .env.example puis lance toute la plateforme
make test    # lance tous les tests
```

L'API publique répond ensuite sur http://localhost:8080 (routes et authentification : [`docs/api-public.md`](docs/api-public.md)).

## Organisation du dépôt

Monorepo unique (voir [ADR-001](docs/adr/001-monorepo.md)) :

| Dossier | Contenu |
|---|---|
| `backend/` | Cargo workspace : `domain`, `connectors`, `api-public`, `api-internal`, `simulator` |
| `db/` | Changelogs Liquibase + Dockerfile de l'image de migration |
| `web/` | Front web |
| `mobile/` | Application mobile |
| `loadtest/` | Scénarios k6 |
| `deploy/helm/epickem/` | Chart Helm |
| `deploy/ansible/` | Provisioning VM, k3s, déploiement |
| `docs/` | Documentation et [ADR](docs/adr/README.md) |

Chaque service est publié comme image Docker indépendante sur GHCR, taguée avec le SHA du commit et, pour une release `vX.Y.Z`, avec sa version semver.

## CI

Le workflow [`ci.yml`](.github/workflows/ci.yml) détecte les composants modifiés et ne lance que leurs workflows. Le job **`ci-ok`** agrège le résultat : c'est le seul check obligatoire pour merger dans `main`. Le job **`gitleaks`** analyse tout l'historique à chaque PR et bloque le merge si un secret est détecté.

## Versions

Les versions sont calculées automatiquement par [semantic-release](https://semantic-release.gitbook.io) à partir des messages de commit ([Conventional Commits](https://www.conventionalcommits.org/fr/)) : `fix:` → patch, `feat:` → minor, `feat!:` ou `BREAKING CHANGE:` → major. Une release se lance **manuellement** (*Actions → Release → Run workflow*, ou `gh workflow run release.yml`) : le workflow [`release.yml`](.github/workflows/release.yml) met à jour [`CHANGELOG.md`](CHANGELOG.md) et les versions de `backend/Cargo.toml` et du chart Helm (commit `chore(release)` signé `semantic-release-bot`), crée le tag `vX.Y.Z` et la [GitHub Release](../../releases) correspondante, puis publie les images avec la version. Sans release, chaque push sur `main` publie les images taguées avec le SHA du commit et `latest`.

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Mobile development

The Expo SDK 58 / React Native 0.88 starter lives in [`mobile/`](mobile/README.md). Its README links to local setup, testing, Docker, native builds, CI/CD, and dependency security documentation. The backend Docker Compose environment is not required to run the starter.
