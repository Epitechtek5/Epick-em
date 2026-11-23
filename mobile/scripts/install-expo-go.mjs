import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// @expo/cli ships with `expo`; npm may hoist it or nest it under expo/node_modules.
const requireFromExpo = createRequire(
  createRequire(import.meta.url).resolve('expo/package.json'),
);
const downloadModule = requireFromExpo(
  '@expo/cli/build/src/utils/downloadExpoGoAsync.js',
);

const root = fileURLToPath(new URL('../', import.meta.url));
const packageJson = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8'),
);
const sdkMajor = packageJson.dependencies.expo.match(/\d+/)?.[0];

function findWindowsAdb() {
  if (process.env.WINDOWS_ADB && existsSync(process.env.WINDOWS_ADB)) {
    return process.env.WINDOWS_ADB;
  }

  const usersRoot = '/mnt/c/Users';
  if (!existsSync(usersRoot)) return null;

  for (const user of readdirSync(usersRoot)) {
    const candidate = path.join(
      usersRoot,
      user,
      'AppData/Local/Android/Sdk/platform-tools/adb.exe',
    );
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

if (!process.env.WSL_DISTRO_NAME) {
  throw new Error('This command is intended for WSL with a Windows emulator.');
}
if (!sdkMajor) throw new Error('Could not determine the Expo SDK version.');

const adb = findWindowsAdb();
if (!adb) throw new Error('Windows adb.exe was not found.');

const apk = await downloadModule.downloadExpoGoAsync('android', {
  sdkVersion: `${sdkMajor}.0.0`,
});
const result = spawnSync(adb, ['install', '-r', apk], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
