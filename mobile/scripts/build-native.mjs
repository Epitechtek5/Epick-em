import environment from '../config/environment.js';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const platform = process.argv[2];

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (platform !== 'android' && platform !== 'ios') {
  throw new Error('Expected android or ios as the build platform.');
}
if (platform === 'ios' && process.platform !== 'darwin') {
  throw new Error('iOS simulator builds require macOS and Xcode.');
}

environment.loadRootEnvironment();
// Existing build commands produce demo artifacts. CI must choose its policy explicitly.
if (process.env.CI && !process.env.EPICKEM_BUILD_PROFILE) {
  throw new Error(
    'Set EPICKEM_BUILD_PROFILE to demo (HTTPS) or demo-emulator (Android emulator only) in CI.',
  );
}
process.env.EPICKEM_BUILD_PROFILE ||=
  platform === 'android' &&
  process.env.EXPO_PUBLIC_API_URL?.startsWith('http://10.0.2.2:')
    ? 'demo-emulator'
    : 'demo';
environment.validateApiEnvironment(process.env, { required: true });
if (
  platform === 'ios' &&
  process.env.EPICKEM_BUILD_PROFILE === 'demo-emulator'
) {
  throw new Error(
    'demo-emulator is Android-only. iOS demo artifacts require an HTTPS API URL.',
  );
}

const windows = process.platform === 'win32';
run(process.execPath, [
  fileURLToPath(new URL('../node_modules/expo/bin/cli', import.meta.url)),
  'prebuild',
  '--platform',
  platform,
  '--no-install',
  '--skip-dependency-update',
  'react,react-native',
]);
mkdirSync(new URL('../build/', import.meta.url), { recursive: true });

if (platform === 'android') {
  // Expo's generated release variant uses the debug key until production signing is configured.
  // Par défaut React Native compile le code natif pour 4 ABI, ce qui domine la durée du build.
  // arm64-v8a couvre les appareils, x86_64 les émulateurs ; surchargeable via MOBILE_ANDROID_ABIS.
  const gradleArgs = [
    'assembleRelease',
    '-Pandroid.cmakeVersion=3.30.5',
    `-PreactNativeArchitectures=${process.env.MOBILE_ANDROID_ABIS || 'arm64-v8a,x86_64'}`,
    '--no-daemon',
  ];
  run(
    windows ? 'cmd.exe' : './gradlew',
    windows ? ['/c', 'gradlew.bat', ...gradleArgs] : gradleArgs,
    `${root}/android`,
  );
  copyFileSync(
    new URL(
      '../android/app/build/outputs/apk/release/app-release.apk',
      import.meta.url,
    ),
    new URL('../build/epickem-android-demo.apk', import.meta.url),
  );
} else {
  run('pod', ['_1.17.0_', 'install'], `${root}/ios`);
  run('xcodebuild', [
    '-workspace',
    'ios/Epickem.xcworkspace',
    '-scheme',
    'Epickem',
    '-configuration',
    'Release',
    '-sdk',
    'iphonesimulator',
    '-destination',
    'generic/platform=iOS Simulator',
    '-derivedDataPath',
    'build/ios',
    // Simulateur Apple Silicon uniquement : évite de compiler une seconde architecture.
    'ARCHS=arm64',
    'ONLY_ACTIVE_ARCH=NO',
    'CODE_SIGNING_ALLOWED=NO',
    'build',
  ]);
  run('tar', [
    '-czf',
    'build/epickem-ios-simulator.tar.gz',
    '-C',
    'build/ios/Build/Products/Release-iphonesimulator',
    'Epickem.app',
  ]);
}
