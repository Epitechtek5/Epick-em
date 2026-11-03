---
name: mobile-git-integration
description: "Resolve stacked PR conflicts without losing backend or mobile changes"
---

# Safe Git integration

- Inspect `git status`, local commits, remotes, base/head, merge base and changes before any merge. `origin` might be a personal fork; fetch the organization explicitly.
- Preserve unpublished work and signing key identity; do not reset --hard, blindly select ours/theirs or force-push.
- Prefer a normal merge for published branches, resolve each conflict by intent; ensure inherited Games/Stats/Teams work isn't duplicated.
- Separate backend worktrees when testing branch-specific Rust APIs rather than merging server history into a mobile PR.
- Regenerate lockfile only after resolving manifest conflicts; test `npm ci` and SDK compatibility.
- Verify rename/modify conflicts due to `src/screens/<domain>` organization, routes and tests.
- Verify no conflict markers, `git diff --check`, focused checks and signed commits (`git verify-commit`).
- Don't disable GPG signing; ask for interactive `gpg-agent` unlock if needed. No push unless requested.

## Project-wide guarantees
- Read `mobile/AGENTS.md`, the current repository layout and relevant code before acting.
- Keep backend contracts authoritative; never fabricate an endpoint, response field, authorization, or successful runtime test.
- Preserve established React Native / Expo Router / TypeScript / NativeWind architecture and existing theme tokens.
- Prefer small, reviewable diffs with expressive names, whitespace and readable JSX. No unrelated reformatting.
- Source identifiers, diagnostics, comments and technical documentation are English; maintain existing French/English translations.
- Never add a dependency without checking necessity, SDK compatibility, lockfile reproducibility and direct/transitive advisories.
- Run focused tests before broad checks; explicitly report what was not run.
- Do not push, change branches, merge, rebase, or rewrite history unless requested. Preserve required GPG signing.
