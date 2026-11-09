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

With a configured emulator, build `npm run build:apk`, install `binaries/epickem.apk` with ADB and use a reachable HTTPS backend according to the existing release network policy. Register a new account, sign in with invalid then valid credentials, restart the app, edit username/password, browse pages/details, and confirm/cancel account deletion. Verify user/watcher cannot open administrative routes and a real backend administrator can edit/delete accounts and safely demote/delete itself. Check refresh after backend access expiry, revoked refresh tokens and logout followed by restart. On macOS repeat these flows on an iOS simulator. Report native testing separately from bundle exports and mocked tests; never use fixture accounts in production code.

## Settings, localization and appearance

The preference tests verify immediate System/Light/Dark switching, SecureStore persistence/restoration, French device defaults, unsupported-language fallback, language changes and storage failures. Resource tests compare complete English/French key sets and interpolation variables, and check status-based backend errors. Registration confirmation tests check centered NativeWind classes and up-to-date login guidance in both languages. Navigation tests mount the real Expo Router stack/tabs, including SVG icons and localized Settings labels; existing authentication, account and permission regressions remain in the suite.

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
