# Architecture

The application uses Expo SDK 58, React Native 0.88, React 19.3 and TypeScript 6. Expo Router owns the entry point (`expo-router/entry`) and discovers routes in `src/app/`.

Public routes are `/login` and `/register`. The root redirects an authenticated session to the Settings tab. The `(authenticated)` layout waits for restoration and redirects missing sessions to Login. Expo Router owns the root Stack, authenticated Stack and Tabs; there is no independent navigator or navigation container. Settings and Users tabs expose account details and pagination; UUID detail and administrator routes are stack screens.

`src/features/auth/client.ts` owns token storage, restoration, refresh and logout. `session.tsx` supplies React state and current profile lookup. `src/lib/api.ts` centralizes HTTP status handling and empty 204 responses. Account API functions use the session request handler, including Bearer headers, expiry checks and bounded retries. Reusable forms and screens live outside `src/app/`.

Registration sends username/password and receives only UUID/username; it shows a success state and a Login link. Login receives access/refresh tokens, token type and expiry, then uses the JWT subject solely as a UUID lookup hint for authenticated `GET /user/{id}`. Client decoding verifies neither identity nor permissions: the backend validates the Bearer token and returns the displayed profile and role. JWT role/username claims are never used for UI authorization.

The Settings tab changes username/password with `PATCH /me/update` and never submits role. Deletion requires a native confirmation before `DELETE /me/delete`, then clears the session. The Users tab requests pages of 20 with limit/offset, supports refresh/retry and opens UUID profiles. Returning to the list reloads it after edits/deletes. Administrator actions use `PATCH /user/{id}/update` and `DELETE /user/{id}/delete`; role controls and direct administrative routes are blocked for `user` and `watcher`. The backend remains authoritative, including immediate authorization checks after demotion. Self-demotion leaves administrative navigation; self-deletion clears credentials. Current profiles refresh on focus, app foreground and updates. Network failures show retryable errors; invalid sessions or missing current accounts clear authentication.

The checked-in OpenAPI document currently includes authentication but omits account routes. Account contracts were verified against `backend/crates/api-public/src/users.rs`; mobile types reflect UUIDs, the three backend roles and partial updates without modifying backend or generated contracts.

Continuous Native Generation keeps native directories untracked. Expo generates them from `app.json`, the installed SDK template and config plugins. Never edit generated native projects to persist configuration. The app supports iOS and Android; web output was deliberately removed from the mobile bootstrap.

The bundle/package identifier is `com.epickem.mobile`; confirm organizational ownership before store registration. `app.json` retains an explicit starter version of `1.0.0`. Repository release tags identify downloadable demo artifacts without rewriting the existing semantic-release versioning process. Store build numbers and version promotion are future distribution work.

Reference: [Expo Router installation](https://docs.expo.dev/router/installation/) and [Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/).

## Appearance, language and tab icons

The Profile route is retained for existing deep links, with the visible tab/header renamed to **Settings**. Its Account section retains backend profile edits and confirmed deletion. Appearance, Language and Session sections provide persisted preferences and one logout control, which delegates to the existing authentication provider.

`src/features/preferences/provider.tsx` restores `epickem.preferences` from the existing SecureStore dependency before mounting the application. This record contains only the theme (`system`, `light`, `dark`) and language (`en`, `fr`), independently of token storage. Changes apply immediately and writes are serialized; failed writes leave the active preference intact and display a localized error. Logout clears authentication credentials and keeps device preferences.

System is the default appearance. NativeWind's color scheme API applies explicit overrides or returns control to native system appearance. The existing `src/theme/colors.ts` tokens drive CSS variables, navigation themes, tab/header colors and status-bar contrast. Expo SystemUI synchronizes the native root background. Expo Router's tab bar retains its automatic safe-area insets; no fixed height or absolute positioning obscures Android navigation controls or the iOS home indicator. The generated Android DayNight theme and automatic iOS appearance remain enabled.

The former tabs omitted `tabBarIcon`, causing React Navigation's `MissingIcon` text-glyph fallback. Explicit Hugeicons `Settings01Icon` and `UserGroupIcon` now render through `react-native-svg`, using the navigator's active/inactive theme colors without an icon font or font asset.

`src/i18n/index.ts` initializes i18next/react-i18next with bundled, matching resources in `src/i18n/locales/en.json` and `fr.json`. Expo Localization supplies the initial device language; French locales use French, while unsupported languages fall back to English. A saved choice takes precedence. React translation subscriptions update screens, accessibility labels, validation, dialogs and navigation immediately. API field names, UUIDs and role values remain unchanged. Validation and HTTP error state store translation keys; known backend failures are mapped by HTTP status, never by comparing server messages. Add every new key and matching interpolation variables to both resource files.

## Native UI composition and motion

The modernization preserves every value in `src/theme/colors.ts`, the Tailwind palette and the existing shadcn-style Button, Input, Card and Text conventions. Composition uses the same semantic surfaces, borders and radii. Buttons and inputs have minimum mobile touch heights rather than fixed text-clipping heights; input focus and validation use the existing ring/destructive tokens.

Public authentication screens share a safe-area-aware, keyboard-avoiding shell and a smaller instance of the unchanged logo. Password visibility controls wrap the existing Input with a labeled vector-icon Button; passwords remain masked by default, including confirmation fields. Registration confirmation retains centered, bilingual text inside a Card. No credential, session or API contract changed.

Settings uses compact account information and an expandable editor. Collapsing hides the editor from screen readers while preserving unsaved values. Theme/language choices use grouped radio rows with selection icons; deletion and logout remain separate actions. User rows show real usernames, UUIDs and role badges; details expose the full selectable UUID. Pagination and pull-to-refresh retain the virtualized list while a populated page refreshes. Administration uses the same summary/form primitives with destructive actions separated below the normal edit form.

`src/lib/motion.ts` centralizes 180–200 ms press, entrance and layout timings. Reanimated drives small press scaling and short fades/layout transitions; large lists have no per-row entrance animations. Motion follows the native reduced-motion setting, including changes while the app is running. The Expo Router tab bar uses primary-filled icon surfaces with primary-foreground glyphs and readable foreground labels, its built-in fade transition, keyboard hiding, and library-managed safe-area geometry. No custom navigation container, icon font, new palette or dependency was introduced.
