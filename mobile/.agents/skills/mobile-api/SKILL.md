---
name: mobile-api
description: "Integrate authenticated mobile endpoints from real Actix/OpenAPI contracts"
---

# API integration workflow

- Inspect backend branch and OpenAPI actually used by runtime. A 404 may mean missing route, missing record or wrong base URL; inspect status and body before attributing cause.
- For each operation list method/path, auth, request body, response, 204 handling, expected errors and authorization.
- Reuse `src/lib/api.ts`, established auth headers and session-refresh coordination. Never send X-User-Id, log JWTs or retry mutations under a changed identity.
- Reuse generated schema where appropriate and existing explicit domain types; distinguish nullable and optional.
- UUIDs must refer to IDs from the same backend/database; do not use labels as identifiers.
- Separate server validation from client UX validation. Backend auth stays authoritative; UI can hide controls but not pretend to enforce access.
- For import/export use current native file support, enforce actual size limits/content type/JSON or CSV wire format.
- Test 200/201/204, 400/401/403/404/409, network errors, malformed responses, cancellation and refresh races as relevant.
- Never alter Rust or Liquibase because the mobile client guessed a contract.

## Project-wide guarantees
- Read `mobile/AGENTS.md`, the current repository layout and relevant code before acting.
- Keep backend contracts authoritative; never fabricate an endpoint, response field, authorization, or successful runtime test.
- Preserve established React Native / Expo Router / TypeScript / NativeWind architecture and existing theme tokens.
- Prefer small, reviewable diffs with expressive names, whitespace and readable JSX. No unrelated reformatting.
- Source identifiers, diagnostics, comments and technical documentation are English; maintain existing French/English translations.
- Never add a dependency without checking necessity, SDK compatibility, lockfile reproducibility and direct/transitive advisories.
- Run focused tests before broad checks; explicitly report what was not run.
- Do not push, change branches, merge, rebase, or rewrite history unless requested. Preserve required GPG signing.
