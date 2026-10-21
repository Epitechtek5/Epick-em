# Docker

From `mobile/`:

```sh
docker build -t epickem-mobile .
docker run --rm epickem-mobile
docker run --rm epickem-mobile npm test -- --watch=false
docker run --rm epickem-mobile npm run typecheck
docker run --rm -p 8081:8081 epickem-mobile npm start -- --lan
```

The default command runs lint, formatting, TypeScript, tests, Expo configuration and native JavaScript export. The image uses the versioned Node 24.21.0 Debian slim image, installs the lockfile with `npm ci` in a cacheable layer, and runs as the non-root `node` user. No native SDKs or extra system packages are installed. Image tags can receive upstream rebuilds; pin a reviewed image digest if byte-for-byte base image reproducibility is required.

The build context excludes dependencies, generated output, credentials and environment files. Do not pass secrets as build arguments. Source is copied into the image for an isolated validation snapshot. Rebuild after edits; a host bind mount can obscure installed dependencies and introduce permission differences, so it is not required for the normal workflow.

Docker supports consistent JavaScript development and validation on WSL, macOS and Linux CI. LAN access to Metro still depends on host networking and firewall rules. Android SDKs and emulators run on the host or dedicated native CI runners. Xcode and iOS simulators require macOS and cannot run in this Linux image.

Docker Desktop must have WSL integration enabled when invoked from WSL. This implementation environment does not expose a working Docker daemon; no successful image build is claimed. CI builds the image and executes its default validation command.
