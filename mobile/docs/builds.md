# Native builds

## Why native CI builds

Expo Continuous Native Generation produces native projects from the committed configuration and lockfile. GitHub-hosted runners compile those projects directly, avoiding an Expo account, cloud build quota or paid Apple membership for demo artifacts. The Node build script runs from any working directory and fails early for iOS on non-macOS hosts. Generated projects are disposable; use a clean checkout for reproducible builds.

SDK 58 requires Android compile SDK 37, target SDK 36 and Xcode 26.4 or newer ([SDK reference](https://docs.expo.dev/versions/v58.0.0/)). Runner images and SDK download availability are external dependencies. CI explicitly selects Xcode 26.4 and fails if it is unavailable rather than compiling with an unsupported version. Native dependency repositories may require network access.

## Android

Install JDK 17 and Android SDK command line tools/Android Studio. Configure `JAVA_HOME`, `ANDROID_HOME` and SDK platform tools; accept the Android SDK licenses. Install SDK platform 37.0 (`platforms;android-37.0`), build tools 37.0.0, NDK 27.1.12297006 and CMake 3.30.5. The build script passes `-Pandroid.cmakeVersion=3.30.5`, which the SDK 58 Expo root Gradle plugin applies to native modules as well as the app. On a clean checkout:

```sh
npm ci
npm run build:android
adb install -r build/epickem-android-demo.apk
```

The script generates Android configuration and runs Gradle `assembleRelease`, producing a self-contained APK with bundled JavaScript. Expo's generated release configuration uses its development/debug signing key by default. This is suitable for a demonstration, not store distribution. A newly generated debug key can differ between runs: uninstall an older demo if Android rejects an update for mismatched signatures. No private production key is stored in the repository or Docker image.

An emulator or physical device must be visible to `adb devices`; a device needs USB debugging enabled. For interactive source development, use `npx expo run:android` with the SDK configured, then Metro. `npm run android` compiles and launches the native development app. Emulators do not need to run in Docker.

## iOS simulator

On macOS with Xcode 26.4+ and a simulator runtime, install/select the pinned CocoaPods version if it is not already available:

```sh
gem install cocoapods --version 1.17.0 --no-document --user-install
export PATH="$(ruby -r rubygems -e 'puts Gem.user_dir')/bin:$PATH"
pod _1.17.0_ --version
```

Boot a simulator in Xcode, then build and install:

```sh
npm ci
npm run build:ios:simulator
tar -xzf build/epickem-ios-simulator.tar.gz -C /tmp
xcrun simctl install booted /tmp/Epickem.app
xcrun simctl launch booted com.epickem.mobile
```

The build uses the Release configuration, `iphonesimulator` SDK, generic simulator destination and `CODE_SIGNING_ALLOWED=NO`. Its compressed `.app` artifact is simulator-only. It cannot be installed on a physical iPhone. Runner and local Mac architectures/runtime compatibility still apply. For source development on macOS, `npx expo run:ios` builds and launches a simulator app; no paid Apple membership is required.

## Optional EAS and store distribution

`eas.json` provides `demo` (APK), `simulator` (unsigned iOS simulator) and `production` (Android App Bundle / physical iOS) profiles. EAS is optional and may have queue, usage and account limits. First create/link an Expo project and commit its EAS project ID using the CLI; organizational identifiers must be confirmed before registration.

```sh
npx eas-cli@25.2.0 build --platform android --profile demo
npx eas-cli@25.2.0 build --platform ios --profile simulator
npx eas-cli@25.2.0 build --platform android --profile production
npx eas-cli@25.2.0 build --platform ios --profile production
```

Use a persistent, protected Android upload key for production AABs. Physical-device iOS distribution produces a signed `.ipa` and normally requires Apple Developer membership, signing certificates and provisioning profiles. Personal-team Xcode testing has separate restrictions and is not a distributable release pipeline. EAS can manage signing credentials without committing them. The optional manual release workflow input is reserved for signed iOS builds after project linking and credentials are configured; see [CI/CD](ci-cd.md). Do not enable it before credentials and service costs are reviewed.

No native compilation or installation success is implied by a successful JavaScript export. See the implementation report for actual local results.
