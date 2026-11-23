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

## Google sign-in and two-factor authentication

Login and registration support Google through the system authentication browser. The backend owns the Authorization Code + PKCE exchange and validates the Google identity. The mobile app stores pending state, expiry, callback URL and linking account ID in SecureStore. It validates the complete callback origin/path and state before consuming the flow once. It never stores Google tokens. Application tokens are stored only after the backend finishes authentication, including any TOTP/recovery-code challenge. A cancelled flow or account switch invalidates pending authorization.

Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` and `TOTP_ENCRYPTION_KEY` on the backend, never in public Expo variables. For mobile, `GOOGLE_REDIRECT_URI` must be `https://<your-domain>/auth/google/callback`, registered on the Google Web OAuth client. Build with `PUBLIC_URL=https://<your-domain>` so Android App Links and iOS Associated Domains claim that host. Publish the Android `/.well-known/assetlinks.json` with the actual signing certificate fingerprint and the iOS `/.well-known/apple-app-site-association` with the actual team/bundle identifiers and `/auth/google/callback` path. Use a signed native build; Expo Go does not validate these application associations. iOS HTTPS authentication callbacks require a supported OS version (iOS 17.4+). A cold callback is handled by the same Expo Router screen after session restoration. A callback with no matching pending flow is rejected.

Settings contains a Security section for Google linking/unlinking, manual TOTP enrollment, disabling 2FA and replacing recovery codes. Copy the setup key into an authenticator and verify its first code before 2FA becomes active. Recovery codes are displayed once in a dedicated modal with an accessible clipboard action and are never persisted by the app. Setup keys and recovery codes are hidden on screen blur or app backgrounding. Android clipboard copies use the sensitive-content flag; users should save the codes securely and clear their clipboard afterwards.

Security changes require a valid authenticated session and an existing second factor where enabled; there is no additional authentication-age limit. Unlinking, disabling and replacing recovery codes revoke refresh tokens on the backend and require signing in again. Google-only users must first set a password through the existing recovery flow before unlinking Google. Invalid verification codes do not trigger session refresh/replay. Expired challenges, rate limits and account conflicts use localized messages (English, French and Spanish).

Automated coverage includes session/token gating, TOTP and recovery authentication, expired challenges, invalid management codes, logout races, callback origin/state validation, cancellation, cold starts, replay prevention, cross-account linking and enrollment/recovery-code UI. Real Google verification additionally requires configured credentials and verified HTTPS associations; iOS runtime verification requires an Apple simulator/device.
