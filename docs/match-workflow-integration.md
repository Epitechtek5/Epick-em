# Match workflow and spectator scoring integration (#161 / #162)

## Ownership and branch flow

- #161 is the match workflow master issue.
- #162 owns backend integration and the correction/notification contract.
- #163 and #164 own the existing web and mobile screens, already implemented in #210.
- #200 / #201 own predictions and Pick'em; their engine is reused from #204.
- The implementation branch implement-match-scheduling-result-validation-and-dispute-resolution
  targets extend-match-scheduling-result-validation-and-dispute-management.
- The master branch contains the existing #210 work as a dependency; its final integration
  targets main. Merge the backend subtask before completing the master PR.
- Do not reimplement the screens or add a second prediction engine.

## Result corrections

The periodic api-internal worker recalculates predictions, Pick'em answers and spectator
leaderboards, including completed tournaments (RESOLVE_INTERVAL_SECS, 30 seconds by
default). It replaces points instead of incrementing them.

Local resolution reads one consistent competition snapshot. Publication acquires the same
competition locks as a correction and verifies the snapshot revision. A stale resolver is
rejected and the next worker pass retries against current results. It cannot overwrite a
newer resolution after a correction.

A corrected semifinal can reopen a started or completed final. Its prior spectator points
then return to pending/zero until a new authoritative result exists. Archived matches resolve
as void. Pick'em questions are recalculated from the corrected standings and qualifications.
A reopened tournament's top-scorer question remains pending until the tournament is finalized
again.

Corrections never reopen prediction windows that were already locked. Migration
0021-preserve-spectator-locks.yaml persists these locks for affected local matches and for
Pick'em when a completed tournament is reopened. HTTP reads expose the locked state; database
triggers and the memory store also reject edits and deletions independently of the client.
The migration has a rollback and does not rewrite prior change sets.

## Notifications and deployment boundary

The existing notification engine handles calls, schedule changes, reports, confirmation
requests, disputes, decisions and corrections. It respects preferences, resolves participants
to recipients, renders FR/EN/ES content, and includes match navigation paths. Replayed
operations use stable notification keys.

Automated integration tests verify actual workflow HTTP requests through MemoryMailer and
MemoryPush, including localized email/push delivery and no duplicate messages on replay.
They do not prove delivery through production Expo/FCM/APNs or email credentials.

External provider configuration, signed builds and foreground/background/terminated-device
delivery checks are explicitly tracked in #212, following the earlier decision to defer
push deployment. Do not report those deployment checks as completed by this PR.

## Verification

- cargo fmt --all --check
- cargo clippy --workspace --all-targets --locked -- -D warnings
- cargo test --workspace --locked -- --include-ignored against isolated PostgreSQL and Redis
- Liquibase migration update, rollback of 0021, and update again
- Web type checking, production build and 556 tests

The integration scenarios include a confirmed result, a completed tournament, a corrected
winner, recalculated prediction/Pick'em points, leaderboard inversion, correction replay,
stale resolution rejection, and notifications. They also cover reopened finals retaining
prediction locks and revoking obsolete points, and PostgreSQL enforcing these guards.
