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

`app.config.js` and Metro load only this public value, without overriding shell/CI values. Docker credentials are never copied into Expo config or the client. CI and Jest skip the personal root file. Do not create `mobile/.env*`. The API client uses Expo's statically inlined `process.env.EXPO_PUBLIC_API_URL`; changing it requires restarting Metro with `npm start -- --clear` and fully reloading the app (or rebuilding a standalone APK).

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
