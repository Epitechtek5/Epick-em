---
name: mobile-security-ci
description: "Investigate Mobile CI and dependencies without concealing security problems"
---

# Security and CI procedure

- Fetch the latest failing workflow jobs and inspect specific failing steps; `ci-ok` usually reflects an upstream component failure.
- Inspect `mobile/scripts/audit-security.mjs`, tests, relevant workflow(s), `package.json` and lockfile before remediation.
- Distinguish direct from transitive vulnerabilities and dev from production impact. Prefer patched compatible upstream versions, then supported alternatives.
- Existing approved exceptions must be exact package+GHSA, documented, and expiration-enforced. NEVER add/broaden an exception without explicit authorization; never describe an accepted risk as fixed.
- Do not bypass with `npm audit fix --force`, legacy peer deps, `continue-on-error`, `|| true` or SDK downgrade.
- Verify `npm ci`, `npx expo install --check`, full and production audits, tests and exports. Avoid upgrading Expo unrelatedly unless SDK check requires it.
- Preserve stable job identifiers and change-filter semantics; improve human-readable job names, GitHub annotations and step summaries. Jobs reading repository scripts require their own checkout.
- Check workflow syntax and meaningful failure cases; distinguish locally validated scripts from a successful GitHub run.

## Project-wide guarantees
- Read `mobile/AGENTS.md`, the current repository layout and relevant code before acting.
- Keep backend contracts authoritative; never fabricate an endpoint, response field, authorization, or successful runtime test.
- Preserve established React Native / Expo Router / TypeScript / NativeWind architecture and existing theme tokens.
- Prefer small, reviewable diffs with expressive names, whitespace and readable JSX. No unrelated reformatting.
- Source identifiers, diagnostics, comments and technical documentation are English; maintain existing French/English translations.
- Never add a dependency without checking necessity, SDK compatibility, lockfile reproducibility and direct/transitive advisories.
- Run focused tests before broad checks; explicitly report what was not run.
- Do not push, change branches, merge, rebase, or rewrite history unless requested. Preserve required GPG signing.
