# Dependency security

## Audit snapshot: 2026-10-20

The zero moderate/high/critical target is **not met**. Full and production audits both exit with status 1. Only the exact temporary exceptions below are accepted by CI; unexpected findings and audit failures fail CI, and neither Expo nor React Native was downgraded. `npm audit fix --force` was not used.

| Tree                    | Moderate | High | Critical |
| ----------------------- | -------: | ---: | -------: |
| Initial full tree       |        0 |   19 |        0 |
| Final full tree         |        0 |   30 |        0 |
| Final `--omit=dev` tree |        0 |   21 |        0 |

The final counts reflect two distinct high-severity advisories propagated through dependent packages. Adding the requested Jest stack adds propagation through Jest/Metro dependencies, increasing the number of flagged packages without adding another distinct high advisory. npm counts affected dependency packages, not independent exploitable application flaws. The raw [full audit](evidence/npm-audit.json), [production audit](evidence/npm-audit-production.json), [initial audit](evidence/npm-audit-before.json) and [dependency paths](evidence/dependency-paths.txt) are included for independent review. These are snapshots, not permanent assurances.

## Unresolved upstream blockers

| Dependency and path                                                                               | Advisory and affected range                                                                                | Exposure and blocker                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expo → @expo/metro → metro-file-map → micromatch@4.0.8 → braces@3.0.3` (also Jest file matching) | [GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), `<=3.0.3`, high | Deeply nested brace patterns can exhaust the Node stack. Development, bundling and testing processes handle file patterns. The newest published braces is 3.0.3 and the advisory lists no patched version. An override to 3.0.3 does not fix it.                                       |
| `expo → @expo/cli → node-forge@1.4.0`, also `@expo/code-signing-certificates → node-forge`        | [GHSA-86w9-cpqp-85rv / CVE-2026-85393](https://github.com/advisories/GHSA-86w9-cpqp-85rv), `<=1.4.0`, high | Malformed RSA signature structures can pass verification in the affected library. Expo CLI certificate handling is development/build tooling. The newest published node-forge is 1.4.0 and the advisory lists no patched version. A safe compatible published override is unavailable. |

npm suggests Expo 44.0.6 / React Native 0.72.17 in parts of the audit graph. These break the mandated SDK 58 / RN 0.88 baseline and are not valid remediation. All published braces and node-forge versions were queried, not only their latest tags. No newer patched package was available.

The propagated full-tree entries are: `@expo/cli`, `@expo/code-signing-certificates`, `@expo/metro`, `@expo/metro-config`, `@jest/environment`, `@jest/fake-timers`, `@jest/transform`, `@react-native/community-cli-plugin`, `@react-native/jest-preset`, `@react-native/metro-config`, `@react-native/virtualized-lists`, `@testing-library/react-native`, `babel-jest`, `braces`, `expo`, `expo-modules-core`, `expo-router`, `jest-environment-node`, `jest-expo`, `jest-haste-map`, `jest-message-util`, `metro`, `metro-config`, `metro-file-map`, `metro-transform-worker`, `micromatch`, `node-forge`, `react-native`, `react-native-reanimated`, and `react-native-worklets`. Their advisory paths are recorded in the JSON evidence; none is an additional distinct advisory.

Safe remediation options are to adopt a published fix once available and rerun all checks, or review and maintain a targeted upstream patch/fork with dedicated security regression tests. Replacing Metro's matcher or Expo's cryptography library without upstream compatibility evidence would be a broader, security-sensitive change. No improvised cryptography patch or package substitution was introduced. Until fixes exist, treat build inputs as untrusted, review PR changes to scripts/configuration and avoid exposing Metro publicly. These precautions reduce exposure; they do not fix either advisory.

## Remediation applied and retained

- The existing `xcode@3.0.1 → uuid@11.1.1` override is retained. Version 11.1.1 fixes [GHSA-w5hq-g745-h8pq / CVE-2026-41907](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Xcode project generation uses the supported CommonJS `v4` API. Both iOS and Android prebuild completed with this override; native iOS compilation was unavailable. No UUID finding remains in the audit.
- Jest initially introduced `babel-plugin-istanbul → @istanbuljs/load-nyc-config@1.1.0 → js-yaml@3.15.2 → argparse@1.0.10 → sprintf-js@1.0.3`, affected by moderate [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). A parent-scoped override replaces only that coverage loader's YAML parser with `js-yaml@4.3.2`, removing the old argparse/sprintf-js path. Source inspection confirmed the loader calls `load`, supported by both parser versions. A regression test loads real YAML through that loader, and Jest tests pass. Legacy YAML-specific types from v3 are intentionally not supported in this project. No moderate advisory remains.
- React DOM is explicitly pinned to SDK 58's React-matching version even though web routes are not enabled: Router/tooling peers otherwise selected React DOM 19.3.1 with an incompatible React peer. Gesture handler is likewise constrained to the SDK-compatible version. A fresh dependency tree has no invalid peers.

The scoped overrides should be removed once their direct parents adopt fixed compatible dependencies. Do not widen them globally.

## Tooling tree versus shipped application

`--omit=dev` is not a bundle scanner: Expo and React Native declare CLI/Metro dependencies in their production dependency trees. Router also declares testing peers. Therefore this audit still flags tooling even when dev dependencies are omitted. It must not be described as a clean production audit.

The screen imports React Native and safe-area UI, and the route imports Expo Router. It does not import file globbing or Node cryptography. Source-map inspection of both exported native bundles found no `braces`, `micromatch`, or `node-forge` source modules (see [bundle evidence](evidence/bundle-inspection.json)). This supports classifying these two advisories as tooling exposure for this starter. It is not a comprehensive native binary security assessment or a guarantee about future imports. Device/runtime verification remains pending.

No application secrets are configured. The Docker context excludes credentials and environment files; CI grants native builds read-only contents access. Signed distribution is default-off and uses a protected environment and Expo token when configured. npm reported deprecated transitive packages and locally blocked optional install scripts; validation succeeded without suppressing those notices. Reassess dependency health on each SDK update.

## CI/CD review confirmation

The review re-queried npm and the two GitHub advisories on 2026-10-20. The published latest versions remain braces 3.0.3 and node-forge 1.4.0, and both advisories still list no patched release. No dependency downgrade, ignored audit execution failure, or branch-protection exception was introduced. CI accepts only the exact temporary advisory/package pairs documented below. Fresh audit evidence and exit statuses appear in the implementation report. The PR paths-filter permission is read-only and scoped to change detection; it does not weaken the security gate.

## Temporary CI exceptions

Run `node scripts/audit-security.mjs` from `mobile/`. The security job runs the deterministic tests with `node --test scripts/audit-security.test.mjs` before invoking the gate. The gate executes `npm audit --json` and `npm audit --omit=dev --json` sequentially, with a two-minute timeout per command. It stops immediately on a failure.

The only accepted advisory/package pairs are:

- `GHSA-vfj7-8cjw-p6xm` on `braces`.
- `GHSA-86w9-cpqp-85rv` on `node-forge`.

These temporary exceptions accept the tooling risks described above; they do not remediate either vulnerability or make the production dependency tree clean. Each run prints the accepted pairs and any unexpected findings. Propagated dependency entries must resolve to advisories in the report. Any additional advisory (including low/info findings), a known advisory on another package, malformed/incomplete JSON, unsupported report format, inconsistent counts, unexpected npm status, signal, spawn error or timeout fails the job. npm status 1 is accepted only as a completed vulnerability report whose findings pass this policy. Neither audit is disabled and no step uses `continue-on-error`.

Review these exceptions on every dependency or Expo SDK update and when upstream publishes a fix. Once a compatible patched version is available, update the dependency tree and lockfile, rerun both raw audits and mobile validation, and remove the corresponding pair from `exceptions` in `scripts/audit-security.mjs`. Update the deterministic fixtures/tests to assert that the removed advisory fails the gate, refresh the evidence and this document, and remove this section once both exceptions are gone. Do not broaden an exception to accommodate a new advisory.
