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

## macOS

Install Xcode and its command line tools for iOS, accept the Xcode license and install a simulator runtime. SDK 58 requires Xcode 26.4 or newer. Install CocoaPods 1.17.0 (`gem install cocoapods -v 1.17.0 --user-install`) before using `npm run build:ios:simulator`. Android needs Android Studio or command line SDK tools, the generated project's SDK versions, and a compatible JDK (CI uses 17).

## Working conventions

Run `npm run validate` before submitting changes. Use `npm run lint:fix` and `npm run format` for automatic fixes. No credentials belong in application source or `EXPO_PUBLIC_*` variables; those values are public in the application bundle.

Install dependencies using `npx expo install <package>` (add `--dev` for tooling). Read the SDK 58 docs first, then run `npx expo install --check` and `npx expo-doctor`. Review security implications and lockfile changes. Generated `android/`, `ios/`, bundles and native artifacts are ignored.
