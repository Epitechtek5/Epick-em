---
name: mobile-tournament-steps
description: "Implement tournament Steps UI from Issue #52 against the Step backend branch"
---

# Tournament Steps: confirmed project facts

**Branches:** latest requested mobile baseline `Teams`; backend branch is `Step` (singular). These branches have diverged. Prefer a mobile branch from `Teams` and a separate `git worktree` on `Step` for API testing. Do not accidentally merge backend history into mobile.

**Issues:** #52 Steps; #49 Tournament dependency. Inspect latest backend `backend/crates/api-public/src/steps.rs`, `step_io.rs`, `tournaments.rs`, and authoritative OpenAPI before coding.

**Confirmed implemented routes in `Step` source:** authenticated list/get/create/update/delete step, get ranking, start step and close step. Read route signatures directly; never infer JSON responses or URLs beyond actual definitions. Viewing is for authenticated users; modifying and lifecycle operations are admin-only. Configuration locks once tournament is ongoing.

**Critical current limitation (explicit backend source):** match-results entry (#46) is not yet wired. Starting a step does NOT generate matches yet; ordered tiebreak criteria are NOT evaluated yet. Current equal-point close ordering uses registration order. `StepMatches` is `NoMatches`, and importing nonempty matches is unsupported. Never claim matching, rounds, tiebreak evaluation or automatic match generation is functional. Display limitations plainly; do not simulate them in mobile.

**Step configuration:** `position`, `format` (`pool`, `swiss`, `single_elim`, `double_elim`), `match_type` (`duel`, `ffa`), `group_count`, `group_size`, `matches_per_group`, `advance_per_group`, `tiebreak`; status `pending|ongoing|finished`. `matches_per_group` and `tiebreak` optional at creation. `tiebreak` is an ordered string array with backend restrictions.

**Business constraints from Issue #52:** first step capacity equals tournament maximum; subsequent capacity equals qualifiers from previous step; advance <= group size; last step yields one winner; Swiss/elimination use one group. Server draws eligible participants randomly; no same-team avoidance. Server calculates ranking and advances next step.

**UI workflow:** tournament details -> ordered step list -> step detail / group rankings -> admin editor/start/close actions. Render statuses, capacity, progression and readable participant/group cards. Add confirmations for start/close and actionable server errors. For match/round views, show only actual data from supported endpoints.

**Integration:** preserve Teams/Games/Stats and existing tournament placeholders. Never invent tournament navigation or use dummy UUIDs. If mobile Tournament feature is absent, add only a minimal verified entry point; report dependency blockers.

**Tests:** API contract, status/permissions, validated configuration, ranking/groups, lifecycle state changes, error/empty/loading, routing and translations. Explicitly test that unsupported match generation isn't advertised.

## Project-wide guarantees
- Read `mobile/AGENTS.md`, the current repository layout and relevant code before acting.
- Keep backend contracts authoritative; never fabricate an endpoint, response field, authorization, or successful runtime test.
- Preserve established React Native / Expo Router / TypeScript / NativeWind architecture and existing theme tokens.
- Prefer small, reviewable diffs with expressive names, whitespace and readable JSX. No unrelated reformatting.
- Source identifiers, diagnostics, comments and technical documentation are English; maintain existing French/English translations.
- Never add a dependency without checking necessity, SDK compatibility, lockfile reproducibility and direct/transitive advisories.
- Run focused tests before broad checks; explicitly report what was not run.
- Do not push, change branches, merge, rebase, or rewrite history unless requested. Preserve required GPG signing.
