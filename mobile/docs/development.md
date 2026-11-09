# Development

Install Node.js 24.21.0 (`.node-version`) with your preferred version manager. Use npm and `npm ci` from `mobile/`; do not mix package managers. The Docker image and CI use the same Node version. Node's bundled npm may differ from the local npm 12 used during implementation; the lockfile format is supported by npm 11 and 12.

```sh
cd mobile
npm ci
npm start
```

Scan the QR code with a compatible Expo Go client, or open the app on a configured emulator. SDK 58 client availability can vary by platform; a native development build is the reliable alternative. `npm run android` and `npm run ios` generate a native development build and launch it on a configured emulator/simulator or device. They require the native tools below.

## WSL Ubuntu

Keep the checkout in the Linux filesystem for file watcher and installation performance. Run Node and npm in WSL. A physical Android device must be able to reach Metro on port 8081 over the local network. WSL networking and Windows firewall rules may require forwarding; use a network configuration appropriate to your machine. Avoid exposing Metro to untrusted networks.

An Android emulator may run on Windows while Metro runs in WSL. Configure ADB connectivity explicitly; do not assume Windows and Linux share ADB devices. Alternatively, build and run Android on a native Linux environment with Android SDK tooling. iOS compilation and simulators require macOS.

### Signed Git commits

Keep Git commit signing enabled and use the configured personal signing key. In an interactive WSL terminal, unlock the key and prime the agent cache:

```sh
export GPG_TTY="$(tty)"
gpg-connect-agent updatestartuptty /bye
printf 'Epickem commit signing cache check\n' | gpg --clearsign >/dev/null
```

The local GPG agent caches the unlocked key for at most eight hours. Codex can then create signed commits without an interactive TTY until that bounded cache expires. The shell profiles set `GPG_TTY` only when a terminal is available. After the cache expires, repeat the unlock procedure in an interactive terminal and retry the commit. Never store or pass the key passphrase through Git, shell arguments, environment variables or files.

## macOS

Install Xcode and its command line tools for iOS, accept the Xcode license and install a simulator runtime. SDK 58 requires Xcode 26.4 or newer. Install CocoaPods 1.17.0 (`gem install cocoapods -v 1.17.0 --user-install`) before using `npm run build:ios:simulator`. Android needs Android Studio or command line SDK tools, the generated project's SDK versions, and a compatible JDK (CI uses 17).

## Working conventions

Run `npm run validate` before submitting changes. Use `npm run lint:fix` and `npm run format` for automatic fixes. No credentials belong in application source or `EXPO_PUBLIC_*` variables; those values are public in the application bundle.

Install dependencies using `npx expo install <package>` (add `--dev` for tooling). Read the SDK 58 docs first, then run `npx expo install --check` and `npx expo-doctor`. Review security implications and lockfile changes. Generated `android/`, `ios/`, bundles and native artifacts are ignored.

## API and Fast Refresh

Keep exactly one local `.env`, at the repository root (copy the root `.env.example` if needed). For the Windows Android emulator:

```dotenv
EXPO_PUBLIC_API_URL=http://10.0.2.2:8080
```

`app.config.js` and Metro load only `EXPO_PUBLIC_API_URL` and the non-secret `PUBLIC_URL`, without overriding shell/CI values. Docker credentials are never copied into Expo config or the client. CI and Jest skip the personal root file. Do not create `mobile/.env*`. The API client uses Expo's statically inlined `process.env.EXPO_PUBLIC_API_URL`; changing it requires restarting Metro with `npm start -- --clear` and fully reloading the app (or rebuilding a standalone APK).

```sh
# From mobile/, with backend Compose services running on port 8080:
npm run android   # initial debug native compile/install; starts Metro
# On later sessions, keep the installed debug app and run:
npm start -- --localhost
```

UI and TypeScript edits use Metro/Fast Refresh. Recompile after native dependency, config plugin, permissions, SDK or native configuration changes. For an existing generated project, apply config changes first with `npx expo prebuild --clean --platform android --no-install`, then `npm run android`. This regenerates disposable native directories. This change needs that initial regeneration/reinstall. Expo Go does not use this project's native plugin; test the installed debug app or demo APK when checking transport policy.

For WSL with a Windows emulator, use Windows SDK `adb.exe` from WSL (or configure a shared ADB server), confirm the emulator with `adb.exe devices`, then run `adb.exe reverse tcp:8081 tcp:8081`. Windows must be able to reach WSL Metro at `http://localhost:8081/status`; verify that first (WSL localhost forwarding or mirrored networking and firewall configuration may be needed). Launch the installed debug app against `http://localhost:8081` through its development menu. The reverse maps emulator localhost to Windows, and Windows forwards to WSL. If Expo CLI cannot see Windows ADB, generate/install the debug APK with the Linux SDK and use Windows `adb.exe install -r android/app/build/outputs/apk/debug/app-debug.apk`, then open it manually. Never mix independent ADB servers unknowingly.

If Windows ADB is available as `adb.exe` on your WSL PATH but Expo cannot discover it, use this documented fallback after configuring the Linux Android SDK:

```sh
npx expo prebuild --platform android --no-install
(cd android && ./gradlew assembleDebug -Pandroid.cmakeVersion=3.30.5)
adb.exe install -r android/app/build/outputs/apk/debug/app-debug.apk
adb.exe reverse tcp:8081 tcp:8081
npm start -- --localhost
```

Open the installed app manually and set its development server to `localhost:8081` if needed. Use the installed Windows SDK's full `adb.exe` path if it is not on PATH. The native compile is needed initially; subsequent source edits only need Metro.

`10.0.2.2` maps to the emulator host (Windows), not a physical device or WSL directly. Windows `http://localhost:8080` must reach the Docker backend, as it does in the reported setup. Physical-device testing uses an accessible HTTPS API URL. The debug policy intentionally allows only emulator/loopback HTTP, so use ADB reverse for Metro rather than a cleartext LAN address.

For an iOS simulator, use the existing root configuration with `EXPO_PUBLIC_API_URL=http://localhost:8080` when the backend runs on the same Mac. For an Android emulator, use `http://10.0.2.2:8080`. Restart Metro after changing this value. The existing release transport policy requires HTTPS; use an accessible HTTPS backend when testing a Release APK. Do not add another environment file or weaken the transport policy for account credentials.

## Language and appearance preferences

Settings provides Account, Appearance, Language and Session sections. Theme and language selections apply without restarting and persist independently of authentication. The first language comes from the device (`fr` uses French; unsupported languages use English), while the initial theme follows the system. To change copy, edit the matching keys in both bundled files under `src/i18n/locales/`; do not add language conditionals to screens or translate backend role values.

Expo Localization is a native dependency and config plugin. Rebuild the native app after installing these changes; Fast Refresh alone cannot install the native module. The existing API URL configuration, backend connectivity and release build commands are unchanged.

## Password reset links

The backend sends `PUBLIC_URL/reset-password?token=...`. The same HTTPS origin must serve the web fallback and the platform association files. Production builds require an HTTPS `PUBLIC_URL` without a path or trailing slash. Expo config registers `/reset-password` as an Android App Link and iOS Universal Link for that host; changing the host requires rebuilding the native applications.

The web server for the configured host must expose both files without redirects and with an appropriate JSON content type:

- `/.well-known/assetlinks.json` must authorize package `com.epickem.mobile` with relation `delegate_permission/common.handle_all_urls` and the SHA-256 fingerprint of every certificate that signs an installed production build. Use the Play Console App Integrity certificate for Play App Signing, or obtain the fingerprint from the actual keystore with `keytool -list -v`. A debug fingerprint does not verify a release application.
- `/.well-known/apple-app-site-association` must authorize `<APPLE_TEAM_ID>.com.epickem.mobile` for the `/reset-password` path under the `applinks` service. Replace the placeholder with the Apple team that signs the application. The file has no `.json` suffix.

Minimal payload shapes are:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.epickem.mobile",
      "sha256_cert_fingerprints": ["<RELEASE_SHA256>"]
    }
  }
]
```

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["<APPLE_TEAM_ID>.com.epickem.mobile"],
        "components": [
          { "/": "/reset-password", "comment": "Password reset links" },
          { "/": "/verify-email", "comment": "Email verification links" }
        ]
      }
    ]
  }
}
```

Verify these files from the public internet, then test a signed installed build with the application both closed and already open. Expo Router delivers the initial and subsequent URLs to the same public route. The application never logs or persists the query token; submitting a successful reset clears any local session.

For controlled Android development, a development build can exercise routing with the custom scheme:

```sh
adb shell am start -W -a android.intent.action.VIEW -d 'epickem://reset-password?token=TEST_TOKEN' com.epickem.mobile
```

This checks route handling only. To test HTTPS verification, use a test HTTPS domain with a real `assetlinks.json` containing the installed build certificate, rebuild with that domain as `PUBLIC_URL`, and invoke `adb shell am start -W -a android.intent.action.VIEW -d 'https://test.example/reset-password?token=TEST_TOKEN'`. A custom-scheme success is not evidence that production App Links or Universal Links are verified. Never use a real reset token in shell history or test logs.

`RESEND_API_KEY`, `MAIL_FROM`, and `PUBLIC_URL` remain backend configuration. The mobile application contains no Resend credential or SDK. The backend generates inline HTML and plain-text bodies; no Resend-hosted template is selected. In local development without Resend, verify the reset lifecycle through backend tests or a controlled test mailer rather than exposing reset tokens through user-facing API responses.

## Account email verification

Publish both hosted templates in Resend using the verified sender `Epick'em <no-reply@epickem.eu>`. Keep the existing password reset template and its public web origin. Set `PUBLIC_URL` to the existing web origin (for example `http://localhost:5173` when the reset page is served there).

| Template alias               | String variable    | Subject and content                                                                                                                                                                                                                        |
| ---------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `email-address-confirmation` | `VERIFICATION_URL` | **Confirmez votre adresse e-mail Epick'em**. Confirm the address for the newly created account or requested address change within 15 minutes. Ignore the message if you did not initiate the request. Use the variable as the link target. |
| `welcome-account`            | `USERNAME`         | **Bienvenue sur Epick'em !** Welcome the named player and describe Epick'em as a place to predict tournament results. Omit credentials, links with tokens and any claim that verification has succeeded.                                   |

The API accepts alias overrides through `RESEND_EMAIL_VERIFICATION_TEMPLATE` and `RESEND_WELCOME_TEMPLATE`. The server alone receives `RESEND_API_KEY`. Registration commits the account and verification hash together, then dispatches the two messages in the background. Each successful insert schedules one welcome attempt. If delivery fails or the process exits after commit, the account remains unverified. Public resend stages a replacement. The previous link remains usable until the provider accepts the new message and the store activates its token. Welcome delivery is best effort with no automatic retry.

Public resend returns 204 for any syntactically valid address. The database enforces a 60-second cooldown and five issuances per account or address per hour. Registration, enrollment and resend share a limit of 30 requests per hour per direct network peer. Instances behind the same proxy share its allowance. The API ignores forwarded IP headers. Configure trusted ingress limits for larger deployments.

Verification and password reset share `PUBLIC_URL`. The verification email opens `/verify-email?token=...`. The browser offers confirmation and a link to the installed app. Verified HTTPS links can open the native screen directly after rebuilding the app with the public host and deploying the platform association files. A localhost URL works only on the device hosting the web service. Disable click tracking for transactional links.
