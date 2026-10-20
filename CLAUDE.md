# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Epick'em is a real-time tournament and prediction (Pick'em) platform. It is a monorepo (ADR-001) and is still at an early stage: the backend binaries are placeholders, `web/` and `mobile/` have no framework yet, and the Helm chart has no templates. The architecture is set out in the ADRs under `docs/adr/`. Read the relevant ADR before you implement a component, because the ADRs describe the target design, not the current code.

**Language:** docs, ADRs, code comments, commit messages and PR descriptions are written in French. Keep it that way.

## Commands

```sh
make up      # copies .env.example to .env if missing, then docker compose up --build -d
make down
make test    # make test-db, then cd backend && cargo test --workspace
make test-db # db/tests/run.sh: throwaway Postgres in Docker, Liquibase update-testing-rollback, then db/tests/*.test.sql
make lint    # cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings
make hooks   # pre-commit install (gitleaks); needs `pipx install pre-commit`
```

Run Cargo from `backend/`:

```sh
cargo test -p domain                    # one crate
cargo test -p domain version_is_set     # one test, matched by name filter
cargo run --bin api-public
```

CI runs Cargo with `--locked`, so commit `backend/Cargo.lock` whenever dependencies change. Clippy warnings fail CI (`-D warnings`), and `unsafe_code` is forbidden across the workspace.

## Architecture

### Backend (`backend/`, Cargo workspace, edition 2024)

- `domain`: pure business logic (tournament engine, scoring, Pick'em resolution). **No I/O**: no network and no database. All binaries share it.
- `connectors`: the `TournamentConnector` trait and the start.gg connector. Per ADR-003, connectors map to a neutral `External*` model, the core does the platform mapping once for all sources, and a generic `ResilientConnector<C>` decorator adds rate limiting, a Redis cache, retry/backoff and a circuit breaker. Imported data always keeps its source and a link to the original.
- `api-public` (binary): everything the web and mobile clients call: auth, admin, score entry, predictions, and WebSocket. Depends only on `domain`.
- `api-internal` (binary): tree advancement, prediction resolution, cascade recalculation, rankings and connector sync. It is not exposed on the ingress.
- `simulator` (binary): plays tournaments **through the public API** like a real client (ADR-004).

One `backend/Dockerfile` builds every binary, selected with `--build-arg BIN=<name>`.

### Event flow (ADR-002)

`api-public` writes to PostgreSQL, then `XADD`s domain events (`match.result`, `score.corrected`, …) to the Redis Stream `events`. `api-internal` consumes them through a consumer group, then `PUBLISH`es `live.*` on Redis Pub/Sub. Every `api-public` instance relays those messages to its own WebSocket clients. The design depends on these rules:

- **api-public alone enforces prediction locking** at write time, by comparing the match start time in the DB with the server clock. api-internal never decides whether a prediction is accepted.
- api-internal processing must be **idempotent**: points are recomputed from state, never incremented.
- Every event carries a unique ID and the version of the entity it concerns.
- `score.corrected` triggers a cascade recalculation and writes an audit-log entry.

### Database (`db/`, Liquibase, ADR-006)

- `db/changelog/db.changelog-master.yaml` includes one file per change, named `NNNN-description.yaml`.
- A merged changeset is **never edited**. Add a new one instead.
- Give each changeset a `rollback` when possible.
- Keep changes backward-compatible so rolling updates work (nullable column → backfill → constraint).
- Demo data does not go in the changelogs; the simulator produces it.
- Tests live in `db/tests/*.test.sql`: plain SQL wrapped in `BEGIN … ROLLBACK`, using `pg_temp.assert(cond, msg)` and `pg_temp.assert_raises(sql, sqlstate, msg)` from `helpers.sql`. CI (`db.yml`) runs the same `db/tests/run.sh`.
- In Compose, the one-shot `migrations` service must finish before the APIs start. In Kubernetes it runs as a Helm pre-install/pre-upgrade Job.

### Deploy

- Local: Docker Compose.
- Online: k3s on a single VM, using the Helm chart `deploy/helm/epickem` and Ansible in `deploy/ansible` (ADR-005).
- Images are published to GHCR, tagged with the commit SHA (plus `latest` on `main`) and with the semver version on a release.

## CI and workflow

- `.github/workflows/ci.yml` uses path filters to run only the workflows for the components that changed (`backend.yml`, `db.yml`, `web.yml`, `mobile.yml`, `deploy.yml`).
- `ci-ok` is the only required check. It is an allowlist: a changed component must report `success`, an unchanged one must report `skipped`. If you add a component, update the filters, the `needs` list and the `ci-ok` loop together.
- `web`/`mobile` CI is skipped until a `package.json` exists. Once it does, CI runs `npm ci`, `npm run lint`, `npm test` and `npm run build`.
- gitleaks scans the full history on every PR. Never commit secrets: `.env` is gitignored, and `STARTGG_TOKEN` is optional because tests use mocks.
- Branches are named `<type>/<issue>-description`. Commits follow Conventional Commits, and semantic-release derives versions from them. With squash merges, the **PR title** must follow the format too. PRs reference their issue (`Closes #N`).
- Releases are triggered manually (`gh workflow run release.yml`). semantic-release updates `CHANGELOG.md`, the `backend/Cargo.toml` version and the Helm chart version via `.github/scripts/bump-version.sh`. Don't bump these by hand.
- Document architecture decisions as a new ADR in `docs/adr/`, using `template.md`.
