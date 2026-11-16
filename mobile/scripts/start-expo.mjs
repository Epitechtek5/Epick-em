import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const expo = fileURLToPath(
  new URL('../node_modules/expo/bin/cli', import.meta.url),
);
const forwardedUrl = 'exp://127.0.0.1:8081';
const localNode = path.join(
  homedir(),
  '.local/share/epickem/node-v24.21.0/bin/node',
);
const node = existsSync(localNode) ? localNode : process.execPath;

function isWsl() {
  return process.platform === 'linux' && process.env.WSL_DISTRO_NAME;
}

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

function runAdb(adb, args, { quiet = false } = {}) {
  return spawnSync(adb, args, {
    encoding: 'utf8',
    stdio: quiet ? 'pipe' : 'inherit',
    timeout: 5_000,
  });
}

function connectedDevice(adb) {
  const result = runAdb(adb, ['devices'], { quiet: true });
  return (
    result.status === 0 &&
    result.stdout.split(/\r?\n/).some((line) => /\sdevice$/.test(line.trim()))
  );
}

async function waitForMetro() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:8081/status');
      if (response.ok) return true;
    } catch {
      // Metro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

async function openOnWindowsEmulator(adb) {
  if (!(await waitForMetro())) {
    console.warn(`Metro did not become reachable at ${forwardedUrl}.`);
    return;
  }

  runAdb(adb, ['reverse', 'tcp:8081', 'tcp:8081']);
  const result = runAdb(adb, [
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    forwardedUrl,
  ]);
  if (result.status !== 0) {
    console.warn(
      'Expo Go is not installed. Run `npm run expo-go:install:windows`, then restart Metro.',
    );
  }
}

const args = process.argv.slice(2);
const hostWasProvided = args.some(
  (arg) =>
    arg === '--localhost' ||
    arg === '--lan' ||
    arg === '--tunnel' ||
    arg === '--host' ||
    arg.startsWith('--host='),
);
const expoArgs = ['start', ...args];
const env = { ...process.env };

if (isWsl()) {
  env.REACT_NATIVE_PACKAGER_HOSTNAME = '127.0.0.1';
  if (!hostWasProvided) expoArgs.push('--lan');

  const adb = findWindowsAdb();
  if (adb && connectedDevice(adb)) {
    void openOnWindowsEmulator(adb);
    console.log(`Windows emulator URL: ${forwardedUrl}`);
  } else {
    console.warn(
      `No Windows Android emulator detected. Start it, then open ${forwardedUrl}.`,
    );
  }
}

const child = spawn(node, [expo, ...expoArgs], {
  cwd: root,
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
