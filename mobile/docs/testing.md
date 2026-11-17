# Testing and quality checks

```sh
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm run typecheck
npm test -- --watch=false
npm run test:watch
npm run config:check
npm run build
npm run validate
```

ESLint uses the SDK 58 Expo flat configuration across source, tests and tooling. Warnings fail validation. Prettier uses single quotes, trailing commas and LF endings for consistent results across WSL and macOS. Generated directories, binary assets, the lockfile and machine-generated audit evidence are excluded from formatting.

TypeScript extends Expo's configuration with strict checking and the `@/` source alias. Jest 30 and `jest-expo` 58 mock native modules without a simulator. React Native Testing Library 14 uses async rendering. Tests run serially for predictable resource use and never call external services.

The starter screen test checks its accessible heading and development-state message. The tooling regression test exercises YAML coverage configuration loading to validate the scoped security override. No snapshots or artificial coverage targets are used. Add behavior-focused component and unit tests as actual logic is introduced; keep tests outside `src/app/`.

`npm run build` exports both native JavaScript bundles and assets. This catches bundler resolution problems but does not validate Gradle, CocoaPods, Xcode or application installation. Native build results must be reported separately.

Run `npm audit --audit-level=moderate` and `npm audit --omit=dev --audit-level=moderate` separately from the offline quality suite. Both remain strict CI checks. See [security](security.md) for current blockers.

Reference: [Expo unit testing](https://docs.expo.dev/develop/unit-testing/).

## CI/CD review fixtures

The optional repository workflow checks require Python 3.11+, PyYAML and `jq` available on PATH, separately from the application's npm dependencies:

```sh
python3 docs/evidence/verify-ci-workflows.py
```

Run from a full repository checkout. The helper executes the real `ci-ok` Bash body with synthetic inputs and the release-upload body with mocked Git/GitHub commands. It also checks tool versions, package wiring and preserved workflow definitions against the recorded review baseline. No real native artifact or release upload occurs. It writes results to `docs/evidence/ci-review-checks.json`. It does not replace actionlint or an actual GitHub Actions run.

## Authentication and account verification

Run the complete required suite from `mobile/`:

```sh
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test -- --watch=false
npx expo install --check
node scripts/audit-security.mjs
npm run build
git diff --check
```

Session tests mock fetch and SecureStore to verify login contracts, restoration, rotation, concurrent requests, bounded retries, refresh failures, logout and late refresh cancellation. Account API tests cover UUID routes, pagination, partial updates, status errors and 204 deletion. Navigation tests mount Expo Router layouts and tabs to catch nested navigator regressions, restoration guards and forbidden administrative deep links. These tests do not establish real backend or device interoperability.

With a configured emulator, build `npm run build:apk`, install `binaries/epickem.apk` with ADB and use a reachable HTTPS backend according to the existing release network policy. Register a new account, confirm the inbox link, sign in with invalid then valid credentials, restart the app, edit username/password, browse pages/details, and confirm/cancel account deletion. Verify user/watcher cannot open administrative routes and a real backend administrator can edit/delete accounts and safely demote/delete itself. Check refresh after backend access expiry, revoked refresh tokens and logout followed by restart. On macOS repeat these flows on an iOS simulator. Report native testing separately from bundle exports and mocked tests; never use fixture accounts in production code.

## Advanced tournaments (#148)

Use the local demo seed's `seed_admin@example.test` account to review registration requests, waiting lists, custom responses, check-in, roles, invitations, duplication and templates. The password is defined in the root `seed_demo.py`. Existing demo rules and field labels can be updated without resetting registrations with `python3 seed_demo.py --bootstrap-admin --refresh-demo-labels` from the repository root.

Check the public catalog and match schedules/results while signed out; private tournaments must remain inaccessible. Open elimination brackets and inspect their match cards. After signing in, open `DEMO - Registration management` and verify a single page scroll reaches the form, participant cards and management actions, including with the keyboard open and large text. Custom responses must use the organizer's field labels, and the owner must display a username. Removing someone else uses “Remove”; withdrawing your own registration uses “Withdraw”. Check the confirmation before accepting either action.

Check English, French and Spanish UI labels separately from organizer-authored content: custom field labels and rules are stored content, not automatically translated UI resources. Revoke a tournament role and revisit its step/match screens to verify permissions refresh without signing out. Unit tests and bundle builds do not replace these native device checks.

## Settings, localization and appearance

The preference tests verify immediate System/Light/Dark switching, SecureStore persistence/restoration, French device defaults, unsupported-language fallback, language changes and storage failures. Resource tests compare complete English/French key sets and interpolation variables, and check status-based backend errors. Verification tests cover registration navigation, resend cooldowns, malformed or expired links, successful confirmation and the return to login. Navigation tests mount the real Expo Router stack/tabs, including SVG icons and localized Settings labels; existing authentication, account and permission regressions remain in the suite.

NativeWind classes and SVG elements in Jest are structural checks, not visual device verification. Build a new native client after adding Expo Localization. When a device is available, install the Release APK, check both tab icons in selected/unselected states, switch all appearance modes and toggle the OS appearance while System is selected. Check status/navigation bars, safe areas, headers, forms and cards in both languages, including large text. Restart to verify persistence; sign out and confirm protected deep links return to Login while preferences remain selected. Repeat on an iOS simulator when macOS/Xcode are available.

## UI modernization regressions

The interaction suite covers masked password defaults and visibility toggles, disabled controls, input focus/validation feedback and forwarded callbacks, expandable account editing with retained drafts, and press behavior with reduced motion both at startup and after an accessibility change. Registration tests also assert that both password fields start masked. Existing API, authentication, pagination, permission, logout, theme/language and navigation tests remain mandatory.

Jest uses the installed Reanimated/Worklets resolver and official Reanimated mock through `jest.setup.js`; no native Worklets runtime runs inside Jest. These tests verify interaction behavior and motion policy, not device frame rates or final pixels. Run all standard checks above, then `npm run build:apk` for a Release artifact.

For native visual review, inspect Login, Register/success, Settings with its editor open and closed, Users, user details and administration. Repeat with English/French, both palettes, large system text, keyboard open/closed, and reduced motion enabled/disabled. Verify long usernames/UUIDs, selected radios, disabled controls, error/loading states, pull-to-refresh, pagination and tab safe areas. Compare token files directly to the pre-change baseline; do not change palette values to fix layout or contrast issues. Report simulator/device checks separately from mocked tests and bundle/APK builds.

## Games management

Games API tests cover Bearer headers, UUID routes, pagination, CRUD/204, field/status errors, exact raw JSON/CSV import/export and shared refresh rotation/retry. File tests cover native cancellation, extension/UTF-8/JSON validation, metadata and bounded-read size checks, results, saving/sharing, recipient file lifetime and failed-file cleanup. Screen/navigation tests cover pagination, refresh deduplication, stale responses, details/image fallbacks, form validation, changed-field edits, image reordering/removal, deletion confirmation and non-admin deep links. Translation tests enforce identical English/French keys and interpolation variables.

For real integration, run a backend containing Draft PR #75 and keep the existing API configuration. Android Emulator uses the existing `10.0.2.2` host mapping; iOS Simulator reaches the host via localhost (see development instructions). Sign in with real admin and non-admin accounts. Verify catalog pages and pull-to-refresh, UUID details and image failures, admin create/edit/delete, both raw export formats, native save/share cancellation and file contents, JSON/CSV imports (including >256 KiB, invalid rows and non-empty stats), result counts and catalog refresh. Confirm user/watcher accounts cannot enter administration and receive backend 403 if their role changes. Exercise expired access-token refresh during both file operations. Inspect both themes, both languages, dynamic text, safe areas and Back navigation on native devices. Record actual backend/device results separately from automated tests.

## Statistics management

`stats-api.test.ts` checks paginated and game-specific reads, UUID paths, authenticated create/PATCH/delete, association writes, 204 responses, validation, duplicate and in-use conflicts, raw JSON/CSV imports and exports, 256 KiB limits, `errors.file` details and shared token rotation. `stats-screens.test.tsx` checks game details for user and watcher roles, admin guards, catalog navigation, shared form validation and confirmed association removal. The i18n test verifies matching English/French keys and interpolation variables. Run the complete required suite shown above and build `npm run build:apk`.

For native verification, install the Release APK on a device with a reachable HTTPS backend containing the statistics endpoints. Sign in with real admin, user and watcher accounts. Check game details in both languages/themes; admin catalog paging, create/edit/delete and association changes; JSON/CSV save/share and import, including missing game names, malformed CSV, duplicate keys and the 256 KiB limit. Confirm the import counts, backend file details and refreshed game associations. Revisit game details after an import and test an expired access token during reads and file operations. A build and mocked tests alone do not establish live integration.

## Match games and configurable statistics (#156)

Use an administrator and one ordinary account on a test backend matching this branch. Associate numeric eliminations, a participant selection (champion), a game selection (map), and MVP with one game. Configure their selection values from Game > Manage statistics. Verify renaming a label preserves its key, removing a value requires confirmation, and invalid or blank labels prevent saving.

Create a two-participant tournament with an ongoing stage and a BO3 match. From match details start game 1, select a map, champions and MVP, enter numbers and a winner. Finish must remain disabled while edits are unsaved and after a failed save. Save, then finish with confirmation. Check 1–0 in the series, immutable game details, and that game 2 can now start. Win twice with the same participant: the match must finish at 2–0, expose backend aggregates, and offer no third game. Also check a 1–1 series can play its deciding game, BO1/BO5, free-for-all ranks, and the existing direct-result BO1 flow.

For team tournaments, verify totals and individual player inputs remain separate, only roster members appear in MVP choices, and the saved player statistics and champion labels appear in the finished-game details. Repeat as the ordinary account: details remain readable, but creation, saving, completion, deletion and statistic administration are unavailable, including direct routes. Test offline loading/retry and save errors. Review narrow screens, large text, both themes and FR/EN/ES. Android runtime verification does not establish iOS runtime behavior.

Automated coverage: `match-games.test.ts`, `match-game-screen.test.tsx`, `matches-screens.test.tsx`, and `stats-screens.test.tsx` cover contracts, scopes, options, roster constraints, invalid inputs, permissions, save-before-finish, confirmation, immutable games and existing flows.

## Match operations and advanced brackets (#160)

Automated workflow coverage verifies independent confirmation, server-controlled permissions, same-operation retries after a lost response, per-game drafts and percentage validation. Notification tests cover the exact authenticated workflow route. Backend integration tests cover conflicting reports, free-for-all consensus, private evidence, scheduling overrides, stale correction previews, downstream reset acknowledgement, atomic PostgreSQL writes, forfeit game archives and rejection of imports that would erase an audit trail.

Manual checks use local fixture accounts rather than production data:

1. In a BO3 with two participants, submit two winning games as player A. Confirm the match is still scheduled/ongoing and A cannot confirm their own report. Open it as B, inspect both games and confirm: the official match must finish 2–0.
2. Submit contradictory reports in another match. Verify finalization is blocked, add a PNG/JPEG/PDF to a reasoned dispute, and resolve as an organizer. Ordinary users must not see the decision controls.
3. Schedule a match, call participants, announce a delay and record attendance. Check the displayed local date/time and refreshed history. Confirm a forfeit explicitly; previous games must be retained in the audit.
4. Correct a finished semifinal. Check the identified downstream matches, required replay acknowledgement, rejection of stale previews and the retained old results. Repeat with a completed final.
5. Exercise generated single/double elimination (including reset final), Swiss next rounds, byes, qualification, manual seeds and BO overrides. Check pan/zoom and names/ranks in both themes and FR/EN/ES.
6. Disconnect during a write, retry, and verify only one history entry. Open a notification workflow deep link before and after login. Repeat native file selection/share and cancellation on Android and iOS separately.

A successful export or APK build does not replace these device checks. Record native evidence independently; Android verification does not establish iOS runtime behavior.

### Local runtime verification, 2026-11-17

An Android release APK was installed on the running Pixel emulator against an isolated local API/database. Verified: real account login, authenticated workflow deep link, authoritative corrected standings, old results in history, participant calls, a ten-minute delay with reason, native document selection/upload followed by dispute submission, and organizer result validation with a mandatory reason. Server reads confirmed the recorded actions and evidence association. Web integration separately verified independent BO3 confirmation and a reasoned correction. iOS JavaScript export passed; native iOS execution was not available in this Windows environment. Remote push delivery still requires the separately configured notification infrastructure.

The full mobile suite passed 387 tests; the workflow subset was rerun after the final preview invalidation change. Lint, formatting, TypeScript and Expo compatibility checks passed. The strict dependency audit remains blocked by the upstream advisory documented in `security.md`.
