---
name: mobile-review
description: "Perform an evidence-based private mobile code review"
---

# Review workflow

- Determine base/head and files changed. Read actual patch and adjacent code, not only change summaries.
- Prioritize correctness, security, lost behavior, authorization, concurrency/session races, React effects, lifecycle, malformed data and cross-platform UX.
- Validate assumptions against backend/OpenAPI; check routes, payloads, status codes and permissions.
- Check regressions from renamed screens, missing imports, stale i18n keys, wrong navigation targets and lockfile churn.
- Flag real defects only, with reproducible scenario, effect, file/line, recommended fix and confidence. Avoid speculative noise.
- Distinguish blockers, recommendations and unverified risks.
- Do not edit code, post reviews or push unless explicitly authorized.

## Project-wide guarantees
- Read `mobile/AGENTS.md`, the current repository layout and relevant code before acting.
- Keep backend contracts authoritative; never fabricate an endpoint, response field, authorization, or successful runtime test.
- Preserve established React Native / Expo Router / TypeScript / NativeWind architecture and existing theme tokens.
- Prefer small, reviewable diffs with expressive names, whitespace and readable JSX. No unrelated reformatting.
- Source identifiers, diagnostics, comments and technical documentation are English; maintain existing French/English translations.
- Never add a dependency without checking necessity, SDK compatibility, lockfile reproducibility and direct/transitive advisories.
- Run focused tests before broad checks; explicitly report what was not run.
- Do not push, change branches, merge, rebase, or rewrite history unless requested. Preserve required GPG signing.
