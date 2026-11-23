# Epick’em mobile

Expo SDK 58 / React Native 0.88 application using TypeScript 6 and Expo Router, with backend authentication, account management, English/French/Spanish screens, synchronized settings and native push notifications.

Use Node.js **24.21.0** and npm (the committed lockfile is authoritative):

```sh
npm ci
npm start
```

Use a compatible Expo Go client for a quick preview, or generate a native development build. See the platform prerequisites before running build scripts.

- [Architecture](docs/architecture.md)
- [Development on WSL Ubuntu and macOS](docs/development.md)
- [Testing and code quality](docs/testing.md)
- [Docker](docs/docker.md)
- [Android and iOS builds](docs/builds.md)
- [CI/CD and release assets](docs/ci-cd.md)
- [Security and unresolved upstream advisories](docs/security.md)

```sh
npm run validate
npm audit --audit-level=moderate
npm audit --omit=dev --audit-level=moderate
```

Raw npm audits still report an upstream picomatch vulnerability. The CI policy temporarily accepts only that advisory until December 1, 2026 (UTC); consult the security document for its exact scope and remaining risk. `npm run build` exports JavaScript bundles; native artifacts require the platform build scripts.

## Tournament import previews

Administrators select a JSON or CSV file, review the backend-generated preview, and explicitly confirm before any data is imported. Destructive replacements/deletions require a separate acknowledgement. Resource counts, server-planned seeding, group placement, match results and progression are expandable and paginated for large files. The mobile client never calculates scoring or qualifications.

The flow uses `POST /tournaments/import/preview?format=json|csv`, then `POST /tournaments/import/apply` with only `preview_id` and `confirm_destructive`. Stale or expired previews require another analysis and review. A network/server failure during confirmation is treated as an unknown outcome: the app does not replay the request and directs the administrator to check the tournaments. Repeated taps are locked; changing accounts or leaving the screen invalidates pending requests. Returning to the tournament catalog reloads it through its existing focus-based loader.

All application labels, accessibility labels and recovery messages are available in English and French. Free-text backend validation diagnostics are preserved in their original language and labelled as server-provided details. Detailed placements/results require the additive `tournaments[].steps` preview field; older servers retain resource summaries with an explicit detail-unavailable message.

Only tournament imports currently expose a backend preview API. Game, statistics and team imports retain their existing contracts. Native export, saving and sharing remain available. The backend preview plans the newer bracket/result models (series games, slots, stage rules) with the same authoritative engines as live results.
