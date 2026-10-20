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
