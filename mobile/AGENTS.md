# Mobile Development Guidelines

This file defines the development standards for the Epick'em mobile application. All contributors and coding agents must follow these instructions.

## 1. Project and scope

- The mobile application uses Expo, React Native, TypeScript, NativeWind and Expo Router.
- Respect the existing architecture, design system, tooling and conventions.
- Inspect the relevant code and backend contracts before making changes.
- Implement only the requested feature and its necessary dependencies.
- Do not refactor unrelated code or introduce unnecessary abstractions.
- Never change backend contracts to accommodate incorrect mobile assumptions.
- Do not commit, push, or modify Git branches unless explicitly requested.

## 2. Code quality and readability

All code is reviewed by humans. Optimize for clarity, maintainability and correctness rather than brevity.

- Use descriptive, consistent names for files, components, functions, variables and types.
- Follow TypeScript and React Native conventions.
- Prefer small, cohesive components and functions with clear responsibilities.
- Separate API calls, authentication logic, validation, reusable components and screens.
- Avoid duplicated logic, deeply nested conditions and unnecessary complexity.
- Use early returns when they improve readability.
- Maintain consistent indentation and formatting.
- Use appropriate vertical whitespace between logical sections.
- Keep expressions, function signatures and JSX layouts readable horizontally.
- Do not compress code into dense one-line expressions.
- Prefer explicit types where they clarify contracts or prevent mistakes.
- Avoid `any`, unnecessary type assertions and suppressed TypeScript or ESLint errors.
- Remove unused imports, unreachable code and temporary debugging statements.
- Use comments when explaining non-obvious behavior, security requirements, important decisions or workarounds.
- Do not add comments that merely repeat what the code already says.
- Avoid unnecessary dependencies, premature optimizations and speculative features.

## 3. Language

- All source code identifiers, comments, documentation and technical messages must be written in English.
- All new documentation and updates to existing documentation must be in English.
- User-facing mobile text should be in English unless localization is explicitly requested.
- Use consistent terminology throughout the application.

## 4. Architecture and navigation

- Use Expo Router as the single navigation system.
- Keep routes and route layouts in `src/app/`.
- Keep business logic, API clients, authentication services, validation and reusable UI outside `src/app/`.
- Never create a second independent navigation container.
- Protect authenticated routes through a consistent session state.
- Keep public authentication routes accessible to unauthenticated users.
- Do not duplicate navigation state or authentication logic across screens.
- Preserve existing working screens and user flows.

## 5. API contracts and authentication

- Treat the backend implementation and OpenAPI specification as the source of truth.
- Verify endpoints, HTTP methods, request bodies, response types and status codes before implementation.
- Respect UUID identifiers and the actual backend role model.
- Never invent API endpoints, response fields or authentication behavior.
- Use the shared API client rather than duplicating HTTP requests.
- Parse HTTP `204 No Content` responses without attempting JSON decoding.
- Use real backend data; never replace integration with fictional accounts or mock production behavior.
- Send protected requests using `Authorization: Bearer <access_token>`.
- Never use `X-User-Id` or other impersonation headers.
- Store sensitive authentication tokens using Expo SecureStore.
- Never log credentials, access tokens, refresh tokens or other secrets.
- Never put secrets in public Expo environment variables.
- Handle session restoration, token expiration, refresh token rotation and logout safely.
- Prevent concurrent refresh operations from reusing a rotated refresh token.
- Do not retry failed authentication indefinitely.
- Backend authorization is authoritative. Client-side role checks only control presentation and navigation.

## 6. Dependency security

- Check whether an existing dependency or native API already satisfies the requirement.
- Add packages only when strictly necessary.
- Use `npx expo install` for Expo and React Native dependencies to maintain SDK compatibility.
- Check package versions, compatibility, maintenance and known security vulnerabilities before installation.
- Never knowingly introduce vulnerable dependencies.
- Update `package.json` and `package-lock.json` together.
- Preserve reproducible installations with `npm ci`.
- Do not use `--force`, `--legacy-peer-deps` or broad dependency upgrades to bypass conflicts.
- Never disable security audits, weaken security policies or add vulnerability exceptions to make CI pass.
- If a secure and compatible dependency cannot be found, report the blocker rather than silently accepting the risk.

## 7. UI and accessibility

- Reuse the project's existing UI components, styling tokens and design patterns.
- Support Android and iOS without platform-specific regressions.
- Provide accessible labels, validation errors, loading indicators and confirmation messages.
- Handle loading, empty, success, error and retry states where appropriate.
- Avoid unnecessary re-renders and keep lists efficient.
- Confirm destructive account operations explicitly.
- Do not expose administrator-only actions to non-administrators.
- Make errors understandable without exposing sensitive technical details.

## 8. Testing and verification

Add or update tests for every meaningful behavior change, including relevant failure cases.

Verify at minimum:

- Form validation and API contracts.
- Authentication, session restoration, token refresh, rotation and logout.
- Protected navigation and role-based access.
- Profile updates and account deletion.
- HTTP error handling and missing data.
- Regression coverage for bugs that were fixed.

Before declaring completion, run from `mobile/`:

```bash
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

Use `npm run build:apk` when Android Release APK verification is required and the build environment supports it.

Run appropriate native runtime tests when an emulator or device is available. A successful build or unit test run alone does not prove native runtime functionality.

Never report a test as passing unless it actually ran and passed. Clearly identify any missing runtime verification.

## 9. Documentation

- Keep mobile documentation accurate and synchronized with implementation changes.
- Document new features, authentication flows, configuration requirements and relevant security decisions.
- Update existing documentation rather than creating redundant files.
- All documentation must be written in English.
- Do not document unimplemented functionality as working.

## 10. Delivery requirements

Before completing a task:

1. Review the diff for unrelated changes, security issues and readability.
2. Confirm the implementation matches the requested acceptance criteria.
3. Ensure formatting, lint, TypeScript and applicable tests pass.
4. Verify newly introduced dependencies are compatible and free of known reported vulnerabilities.
5. Update relevant documentation.
6. Report modified files, behavior implemented, test results and remaining limitations.
7. Do not claim end-to-end success unless the relevant application flow was actually tested.

Correctness, security, human readability and maintainability take precedence over implementation speed.
