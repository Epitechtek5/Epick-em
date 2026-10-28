# Dependency security

## Current audit snapshot: 2026-10-28

The raw npm reports contain 15 affected packages in the full tree and 13 in the production tree; every entry propagates the same low-severity `deepmerge` advisory. The strict gate temporarily accepts only `deepmerge` / `GHSA-gcqx-w48m-w2h4` through the November 28, 2026 review deadline. Raw `npm audit` still exits with status 1. The mobile security job succeeds only if both reports are valid, all findings match existing exceptions, and no exception has expired.

| Tree              | Low | Moderate | High | Critical |
| ----------------- | --: | -------: | ---: | -------: |
| Full tree         |  15 |        0 |    0 |        0 |
| `--omit=dev` tree |  13 |        0 |    0 |        0 |

The counts represent affected packages, not distinct advisories. The audit script reports the package, GHSA, severity, affected range and remediation information, and runs both tree scans before failing. Reproduce the current result with `node scripts/audit-security.mjs` from `mobile/`.

### Historical snapshot: 2026-10-20

The zero moderate/high/critical target is **not met**. Full and production audits both exit with status 1. Only the exact temporary exceptions below are accepted by CI; unexpected findings and audit failures fail CI, and neither Expo nor React Native was downgraded. `npm audit fix --force` was not used.

| Tree                    | Moderate | High | Critical |
| ----------------------- | -------: | ---: | -------: |
| Initial full tree       |        0 |   19 |        0 |
| Final full tree         |        0 |   30 |        0 |
| Final `--omit=dev` tree |        0 |   21 |        0 |

The final counts reflect two distinct high-severity advisories propagated through dependent packages. Adding the requested Jest stack adds propagation through Jest/Metro dependencies, increasing the number of flagged packages without adding another distinct high advisory. npm counts affected dependency packages, not independent exploitable application flaws. Generated audit reports and dependency-path logs are intentionally not tracked in Git. Reproduce current findings with the security audit script; the counts above are historical snapshots, not permanent assurances.

## Unresolved upstream blockers

| Dependency and path                                                             | Advisory and affected range                                                                      | Exposure and blocker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `expo → @expo/config → deepmerge@4.3.1`; `jest → jest-config → deepmerge@4.3.1` | [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), `>=4.2.0 <=4.3.1`, low | The advisory describes prototype poisoning in `mergeObject`; GitHub lists no patched release. Expo SDK 58's `@expo/config@58.0.8` and Jest 30's `jest-config@30.5.2` both require `deepmerge ^4.3.1`. The reviewed call sites merge local app configuration, plugin properties and Jest options rather than mobile-user API data, but npm reports the package in both dependency trees. npm's suggested Expo 51 downgrade is incompatible and does not constitute a safe fix. A narrowly scoped CI exception accepts only this package/advisory pair through November 28, 2026; it does not remediate the vulnerability or make either raw npm audit clean. Reassess before that date and remove the exception as soon as compatible upstream fixes are available. |

| Dependency and path                                                                               | Advisory and affected range                                                                                | Exposure and blocker                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expo → @expo/metro → metro-file-map → micromatch@4.0.8 → braces@3.0.3` (also Jest file matching) | [GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), `<=3.0.3`, high | Deeply nested brace patterns can exhaust the Node stack. Development, bundling and testing processes handle file patterns. The newest published braces is 3.0.3 and the advisory lists no patched version. An override to 3.0.3 does not fix it.                                       |
| `expo → @expo/cli → node-forge@1.4.0`, also `@expo/code-signing-certificates → node-forge`        | [GHSA-86w9-cpqp-85rv / CVE-2026-85393](https://github.com/advisories/GHSA-86w9-cpqp-85rv), `<=1.4.0`, high | Malformed RSA signature structures can pass verification in the affected library. Expo CLI certificate handling is development/build tooling. The newest published node-forge is 1.4.0 and the advisory lists no patched version. A safe compatible published override is unavailable. |

npm suggests Expo 44.0.6 / React Native 0.72.17 in parts of the audit graph. These break the mandated SDK 58 / RN 0.88 baseline and are not valid remediation. All published braces and node-forge versions were queried, not only their latest tags. No newer patched package was available.

The propagated full-tree entries are: `@expo/cli`, `@expo/code-signing-certificates`, `@expo/metro`, `@expo/metro-config`, `@jest/environment`, `@jest/fake-timers`, `@jest/transform`, `@react-native/community-cli-plugin`, `@react-native/jest-preset`, `@react-native/metro-config`, `@react-native/virtualized-lists`, `@testing-library/react-native`, `babel-jest`, `braces`, `expo`, `expo-modules-core`, `expo-router`, `jest-environment-node`, `jest-expo`, `jest-haste-map`, `jest-message-util`, `metro`, `metro-config`, `metro-file-map`, `metro-transform-worker`, `micromatch`, `node-forge`, `react-native`, `react-native-reanimated`, and `react-native-worklets`. These historical entries propagate the two upstream advisories; none is an additional distinct advisory.

Safe remediation options are to adopt a published fix once available and rerun all checks, or review and maintain a targeted upstream patch/fork with dedicated security regression tests. Replacing Metro's matcher or Expo's cryptography library without upstream compatibility evidence would be a broader, security-sensitive change. No improvised cryptography patch or package substitution was introduced. Until fixes exist, treat build inputs as untrusted, review PR changes to scripts/configuration and avoid exposing Metro publicly. These precautions reduce exposure; they do not fix either advisory.

## Remediation applied and retained

- The existing `xcode@3.0.1 → uuid@11.1.1` override is retained. Version 11.1.1 fixes [GHSA-w5hq-g745-h8pq / CVE-2026-41907](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Xcode project generation uses the supported CommonJS `v4` API. Both iOS and Android prebuild completed with this override; native iOS compilation was unavailable. No UUID finding remains in the audit.
- Jest initially introduced `babel-plugin-istanbul → @istanbuljs/load-nyc-config@1.1.0 → js-yaml@3.15.2 → argparse@1.0.10 → sprintf-js@1.0.3`, affected by moderate [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). A parent-scoped override replaces only that coverage loader's YAML parser with `js-yaml@4.3.2`, removing the old argparse/sprintf-js path. Source inspection confirmed the loader calls `load`, supported by both parser versions. A regression test loads real YAML through that loader, and Jest tests pass. Legacy YAML-specific types from v3 are intentionally not supported in this project. No moderate advisory remains.
- React DOM is explicitly pinned to SDK 58's React-matching version even though web routes are not enabled: Router/tooling peers otherwise selected React DOM 19.3.1 with an incompatible React peer. Gesture handler is likewise constrained to the SDK-compatible version. A fresh dependency tree has no invalid peers.

The scoped overrides should be removed once their direct parents adopt fixed compatible dependencies. Do not widen them globally.

## Tooling tree versus shipped application

`--omit=dev` is not a bundle scanner: Expo and React Native declare CLI/Metro dependencies in their production dependency trees. Router also declares testing peers. Therefore this audit still flags tooling even when dev dependencies are omitted. It must not be described as a clean production audit.

The screen imports React Native and safe-area UI, and the route imports Expo Router. It does not import file globbing or Node cryptography. Source-map inspection of both exported native bundles found no `braces`, `micromatch`, or `node-forge` source modules during the initial review (generated bundle inspection output is not tracked). This supports classifying these two advisories as tooling exposure for this starter. It is not a comprehensive native binary security assessment or a guarantee about future imports. Device/runtime verification remains pending.

No application secrets are configured. The Docker context excludes credentials and environment files; CI grants native builds read-only contents access. Signed distribution is default-off and uses a protected environment and Expo token when configured. npm reported deprecated transitive packages and locally blocked optional install scripts; validation succeeded without suppressing those notices. Reassess dependency health on each SDK update.

## CI/CD review confirmation

The review re-queried npm and the GitHub advisory on 2026-10-28. The advisory still lists no patched `deepmerge` release. No dependency downgrade, ignored audit execution failure, or branch-protection exception was introduced. The single new exception is exact-match and expires after the documented review deadline. The PR paths-filter permission is read-only and scoped to change detection; it does not weaken the security gate.

## Temporary CI exceptions

Run `node scripts/audit-security.mjs` from `mobile/`. The security job runs the deterministic tests with `node --test scripts/audit-security.test.mjs` before invoking the gate. Tests use only the small synthetic npm audit v2 reports in `scripts/__fixtures__/audit-full.json` and `audit-production.json`, including propagated dependency entries and matching metadata counts. Each test reads a fresh copy; neither tests nor fixtures require generated reports, a `docs/evidence/` directory, installed dependencies, or network access. These fixtures model policy behavior, not the current dependency inventory. The gate executes `npm audit --json` and `npm audit --omit=dev --json` sequentially, with a two-minute timeout per command. It attempts both scans, reports each result and fails after collecting the findings.

The audit gate recognizes these existing advisory/package pairs, plus the single temporary exception below:

- `GHSA-vfj7-8cjw-p6xm` on `braces`.
- `GHSA-86w9-cpqp-85rv` on `node-forge`.
- `GHSA-rj75-hqrm-r3gf` on `postcss-selector-parser` (pre-existing; unchanged in this task).

The temporary exception is:

- `GHSA-gcqx-w48m-w2h4` on `deepmerge`, valid through November 28, 2026 (UTC); it fails closed beginning November 29 unless explicitly reassessed.

The new exception acknowledges the current upstream blocker; it does not remediate it or make either dependency tree vulnerability-free. The repository contains no separate exception-approval workflow; this exception was explicitly authorized in the task request. Obtain any additional organizational approval required before relying on it. Each CI run distinguishes clean policy results, accepted known advisories and new or expired findings. Accepted advisory links must exactly match their package. Any other advisory (including low/info findings), an expired temporary exception, malformed/incomplete JSON, unsupported report format, inconsistent counts, unexpected npm status, signal, spawn error or timeout fails the job. npm status 1 is accepted only as a completed vulnerability report whose findings pass this policy. Neither audit is disabled and no step uses `continue-on-error`.

Review these exceptions on every dependency or Expo SDK update and when upstream publishes a fix. Once a compatible patched version is available, update the dependency tree and lockfile, rerun both raw audits and mobile validation, and remove the corresponding pair from `exceptions` in `scripts/audit-security.mjs`. Update the deterministic fixtures/tests to assert that the removed advisory fails the gate, refresh the evidence and this document, and remove this section once both exceptions are gone. Do not broaden an exception to accommodate a new advisory.

## Mobile session lifecycle

The app stores one token pair and expiry timestamp in Expo SecureStore (`epickem.session`), never passwords or profile claims. SecureStore is installed with Expo's SDK-compatible installer and configured through its config plugin. Rebuild native clients after installing this module. Tokens are sent only as Bearer headers and refresh/logout JSON bodies, never in URLs or logs. HTTP errors expose status-based English messages rather than arbitrary backend text.

Restoration blocks protected navigation until the stored session and backend profile have been checked. Expired access tokens are refreshed using the expired Bearer token plus the opaque refresh token. One shared promise serializes rotation; concurrent failures reuse the resulting pair, and each eligible 401 request is retried at most once. SecureStore writes are serialized, and session generations prevent late refreshes from resurrecting a cleared session. Rotation/storage failures clear the session. A transient restoration failure currently requires signing in again rather than exposing an unvalidated cached profile.

Logout revokes the current refresh token through `/logout`, refreshing access first if necessary, and clears local credentials even when the server cannot be reached. Offline logout cannot guarantee server revocation; access JWTs remain valid until backend expiry. Account deletion clears local credentials after backend success. No client permission check grants backend access, and roles are obtained from authenticated profile responses rather than decoded JWT claims.
