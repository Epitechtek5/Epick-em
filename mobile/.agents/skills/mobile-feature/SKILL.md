---
name: mobile-feature
description: "Implement or extend a mobile feature in the current Epick-em architecture"
---

# Mobile feature workflow

1. Establish the requested acceptance criteria, identify the owning domain and read analogous existing implementations.
2. Inspect actual backend DTOs, routes and status codes; create a short contract matrix before implementing.
3. Reuse existing primitives and API client. Route files stay thin under `src/app`; screens under `src/screens/<domain>`; domain code under `src/features/<domain>`; components under `src/components/<domain>`.
4. Model loading, success, empty, error, refresh, unauthorized, and server conflict states as applicable.
5. Implement incrementally: request/response types -> API -> validation -> UI -> navigation -> i18n -> tests. Avoid extra layers.
6. Tests: success + HTTP error + missing data + permissions + user interaction + regression. No fictional production data.
7. Verify `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test -- --watch=false`, `npm run build`, and security/Expo checks as relevant.
8. Review `git diff --stat` and patch for unrelated changes. Report implemented behavior separately from unverified behavior.

## Project-wide guarantees
- Read `mobile/AGENTS.md`, the current repository layout and relevant code before acting.
- Keep backend contracts authoritative; never fabricate an endpoint, response field, authorization, or successful runtime test.
- Preserve established React Native / Expo Router / TypeScript / NativeWind architecture and existing theme tokens.
- Prefer small, reviewable diffs with expressive names, whitespace and readable JSX. No unrelated reformatting.
- Source identifiers, diagnostics, comments and technical documentation are English; maintain existing French/English translations.
- Never add a dependency without checking necessity, SDK compatibility, lockfile reproducibility and direct/transitive advisories.
- Run focused tests before broad checks; explicitly report what was not run.
- Do not push, change branches, merge, rebase, or rewrite history unless requested. Preserve required GPG signing.
