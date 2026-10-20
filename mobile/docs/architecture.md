# Architecture

The application uses Expo SDK 58, React Native 0.88, React 19.3 and TypeScript 6. Expo Router owns the entry point (`expo-router/entry`) and discovers routes in `src/app/`.

```text
src/app/_layout.tsx           Root stack navigator
src/app/index.tsx             Home route exporting the starter screen
src/components/welcome-screen.tsx
src/types/expo.d.ts           Expo type reference
__tests__/                   Component and tooling regression tests
scripts/build-native.mjs     Native generation and artifact packaging
app.json                     Shared configuration and platform identifiers
```

Routes contain navigation wiring; reusable UI stays outside the route directory so it cannot accidentally become a screen. Imports use `@/` for application modules and relative paths for nearby modules. Strict TypeScript checking is enabled. The starter screen respects safe areas and exposes its application heading to accessibility services.

There is one screen and no service layer, state framework, theme, authentication or API client. Additional layers should follow actual feature needs. Template tabs, animations, CSS, theme hooks and reset scripts were removed with their unused direct dependencies.

Continuous Native Generation keeps native directories untracked. Expo generates them from `app.json`, the installed SDK template and config plugins. Never edit generated native projects to persist configuration. The app supports iOS and Android; web output was deliberately removed from the mobile bootstrap.

The bundle/package identifier is `com.epickem.mobile`; confirm organizational ownership before store registration. `app.json` retains an explicit starter version of `1.0.0`. Repository release tags identify downloadable demo artifacts without rewriting the existing semantic-release versioning process. Store build numbers and version promotion are future distribution work.

Reference: [Expo Router installation](https://docs.expo.dev/router/installation/) and [Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/).
