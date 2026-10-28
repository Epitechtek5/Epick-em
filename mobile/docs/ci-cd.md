# CI/CD and release assets

## Pull requests

The existing `ci.yml` path filter still calls reusable backend, database, web, deploy and mobile workflows. Mobile and relevant workflow changes trigger `mobile.yml`. Its validation job runs `npm ci`, ESLint, Prettier, strict TypeScript, Jest, Expo dependency checks, Expo Doctor 1.21.5, config evaluation, both native JavaScript exports and Docker build/validation. Node/npm download caching uses the mobile lockfile. A separate security job runs both full and production audits at moderate severity; failures are not ignored. The `changes` job alone receives `contents: read` and `pull-requests: read`, as required by the paths-filter PR API. Other jobs retain their existing permissions. The `ci-ok` aggregator always runs: it requires change detection and secret scanning to succeed, changed components to succeed, and unchanged components to be skipped. Missing/invalid filter outputs, failures, cancellation and unexpected skips fail the required check. A failing mobile security job makes the reusable mobile result fail and therefore fails `ci-ok`. No branch protection setting is changed.

The new mobile security job currently fails on unresolved upstream advisories. That deliberately blocks approval under the existing required-check policy. Native artifact production in the release workflow is separate from PR checks, matching the repository's existing separation of release and CI; artifact availability alone does not certify a green CI or security approval.

## Main branch artifacts

The existing `release.yml` workflow calls `mobile-builds.yml` for every push to main, independently of path filtering. Android uses Ubuntu, JDK 17, Gradle cache, and explicit SDK packages: platform-tools, platform 37.0 (`platforms;android-37.0`), build tools 37.0.0, NDK 27.1.12297006 and CMake 3.30.5. These match the installed RN 0.88 version catalog and CMake configuration. Command-line tools revision 16111833 (23.0) is pinned from Google’s current repository metadata; Android setup accepts SDK licenses; Maven/Google dependency downloads still require network access. iOS uses `macos-26` with Xcode 26.4.1, verifies the simulator SDK, and installs/selects CocoaPods 1.17.0 through Ruby user gems. The native script invokes that exact CocoaPods version. No signing credentials are required for simulator compilation. The [runner image manifest](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md) lists this Xcode version; runner software can change and must be maintained. Native jobs are capped at 60 minutes. Dependency installation uses `npm ci` with npm download caching on both platforms.

Artifacts are requested for 30 days, subject to repository retention policy. Each includes a matching `.commit` sidecar identifying its source SHA. `overwrite: true` permits rebuilding the same named artifact during a rerun; compression is disabled for already compressed APK/archive payloads:

| Actions artifact        | File                           | Purpose                                                |
| ----------------------- | ------------------------------ | ------------------------------------------------------ |
| `epickem-android-demo`  | `epickem-android-demo.apk`     | Standalone APK signed with a development/debug key     |
| `epickem-ios-simulator` | `epickem-ios-simulator.tar.gz` | Unsigned simulator `.app`, never a physical-device IPA |

Only main pushes and actual manual releases compile native artifacts. PRs export JavaScript instead, avoiding two native builds for every edit. macOS consumes more hosted-runner minutes; availability, repository plan, quota and third-party downloads are external constraints. Neither emulator boot nor paid Apple membership is needed to compile simulator artifacts.

## Existing GitHub Releases

Manual Release dispatch still invokes semantic-release, preserves `vX.Y.Z`, updates the existing backend/chart manifests and creates exactly one release. Existing service image publication is unchanged. When semantic-release outputs a version, a read-only `mobile-source` job resolves the fully qualified tag to a commit SHA; otherwise, main pushes resolve the triggering SHA. Both native jobs receive and verify that immutable SHA. They do not fall back to a moving branch. The asset job waits for both native builds and semantic-release, downloads artifacts from the same workflow run and uploads only to the existing release:

- `epickem-vX.Y.Z-android-demo.apk`
- `epickem-vX.Y.Z-ios-simulator.tar.gz`

Both named Actions artifacts must download from the same run. Upload checks that both payloads are nonempty, that both `.commit` sidecars match the resolved source SHA, and that the release tag still identifies that SHA. `gh release view` must succeed before upload; no fallback creates a release. Missing files or mismatched provenance stop before any upload. Sidecars stay in Actions; only the two explicitly named native payloads are attached to the release.

`--clobber` makes asset replacement retries idempotent. Existing release concurrency serializes workflow runs. If native compilation fails after semantic-release succeeds, the release remains created without mobile assets; rerun the failed build/upload jobs in that original run within artifact retention. Do not dispatch a new semantic-release run to repair assets: it can correctly report no new version and skip mobile publication. A full workflow rerun can also lose the new-version output if semantic-release finds no new release; prefer rerunning failed/specific jobs with their successful dependencies preserved.

Asset upload is not atomic: a network failure can leave one payload attached. Rerun the upload job to replace both. If an artifact expired or was deleted, rebuild its native job and then rerun upload in the same original run; `overwrite: true` avoids artifact-name conflicts. Reruns are available for up to 30 days; after that, recovery requires an explicitly reviewed workflow extension targeting the existing tag/release, not a duplicate release. Organization retention limits may shorten availability. Do not manually publish assets during implementation.

If semantic-release itself fails after creating a tag or release, mobile source resolution and uploads stay blocked. Inspect the existing tag/release before recovery: a rerun may report no new version. This implementation does not infer a missing release version or create a replacement release; recovery from partial semantic-release publication requires a reviewed extension targeting the existing tag.

Only the asset upload job receives `contents: write`; native compilation receives read-only repository permissions and no signing secrets. Existing semantic-release and container-image permissions remain intact. Nothing was published during implementation.

## Future signed iOS distribution

The `build_signed_ios` manual Release input defaults to false. Enabling it requests a production EAS iOS build and waits for completion; it does not submit to a store or attach an IPA to GitHub Releases. The simulator release asset remains clearly separate. Before enabling:

1. Create/link the EAS project and commit its project ID in app configuration.
2. Configure Apple membership, certificates and provisioning profiles in EAS using an authorized account.
3. Use the `prod` GitHub environment (required reviewers set), and store `EXPO_TOKEN` as an environment secret.
4. Review EAS usage costs and run the manual workflow only from an approved revision.

The optional job pins EAS CLI 25.2.0. Apple credentials stay in EAS credential management, outside source and Docker. No credentials or accounts were available, so this path was not executed. Production Android uses the `production` EAS AAB profile documented in [builds](builds.md).

## Execution evidence and GitHub validation still required

Local validation executes the actual `ci-ok` Bash body against successful, failing, cancelled, skipped and malformed filter fixtures, and the release-upload Bash body with mocked Git/GitHub CLI commands. Those checks verify guards and command construction, not GitHub scheduling, permissions or real uploads. Workflow syntax is checked with actionlint. Full details and raw results are in the [implementation report](BOOTSTRAP_IMPLEMENTATION_REPORT.md).

A GitHub run is still needed to verify PR/fork token permissions, reusable-workflow result propagation, main-push scheduling with skipped semantic-release, runner SDK/gem downloads, actual native compilation, artifact overwrite/download behavior, retained job outputs on failed-job reruns, and release attachment using repository token permissions. The GitHub CLI is unavailable locally and the modified workflows have not been pushed, as instructed. GitHub cannot execute these local changes without a later authorized commit/push; no remote run was triggered. Required-check/ruleset settings must be inspected by a repository maintainer; no branch protection changes are proposed.

## Required public API configuration

Set repository Actions **variables**, not secrets (Settings → Secrets and variables → Actions → Variables):

- `MOBILE_API_URL`: public API base URL, without trailing slash. Required for Android artifacts.
- `MOBILE_ANDROID_BUILD_PROFILE`: `demo` (default, requires HTTPS) or `demo-emulator` (explicit Android emulator demo; permits HTTP only to `10.0.2.2`).
- `MOBILE_IOS_API_URL`: HTTPS API URL for the iOS simulator artifact; falls back to `MOBILE_API_URL`. Required separately if Android uses the emulator HTTP URL, which is not an iOS host address.

No API host is invented and no developer `.env` is loaded in Actions. Missing/invalid values fail before native compilation. For an Android emulator demo set `MOBILE_ANDROID_BUILD_PROFILE=demo-emulator` and `MOBILE_API_URL=http://10.0.2.2:8080`; also provide an actual HTTPS endpoint in `MOBILE_IOS_API_URL` for the existing iOS job. For physical-device demos use `demo` and a reachable HTTPS API. API URLs are public and bundled at build time; changing a repository variable requires rebuilding/downloading the artifact.

`release.yml` continues to call the reusable workflow and attach its unchanged artifact names and commit sidecars. Both main builds and manually tagged releases use the same configuration rules. Release-variant demo signing does not make the artifact a production build; production transport remains HTTPS-only. See [native build policies and APK testing](builds.md#api-profiles-and-android-transport).
