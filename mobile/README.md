# Epick’em mobile

Expo SDK 58 / React Native 0.88 application using TypeScript 6 and Expo Router, with backend authentication, account management, bilingual English/French screens and persistent appearance settings.

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

The security audits currently fail on upstream tooling advisories; consult the security document before approval. `npm run build` exports JavaScript bundles; native artifacts require the platform build scripts.
