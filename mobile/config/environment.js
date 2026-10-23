/* global __dirname */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { parse } = require('dotenv');

// Only the public API URL crosses from Docker's environment into mobile tooling.
function loadRootEnvironment({
  env = process.env,
  filename = path.resolve(__dirname, '../../.env'),
} = {}) {
  if (env.CI || env.NODE_ENV === 'test' || env.EXPO_NO_DOTENV === '1') return;
  if (env.EXPO_PUBLIC_API_URL !== undefined) return;
  try {
    const value = parse(readFileSync(filename)).EXPO_PUBLIC_API_URL;
    if (value !== undefined) env.EXPO_PUBLIC_API_URL = value;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function validateApiEnvironment(env = process.env, { required = false } = {}) {
  const profile = env.EPICKEM_BUILD_PROFILE || 'production';
  if (!['production', 'demo', 'demo-emulator'].includes(profile)) {
    throw new Error(
      'EPICKEM_BUILD_PROFILE must be production, demo or demo-emulator.',
    );
  }
  const value = env.EXPO_PUBLIC_API_URL;
  if (!value) {
    if (required || env.EPICKEM_BUILD_PROFILE) {
      throw new Error(
        'EXPO_PUBLIC_API_URL is required. Set the public API URL before building.',
      );
    }
    return profile;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL must be an absolute HTTP(S) URL.');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    value.endsWith('/')
  ) {
    throw new Error(
      'EXPO_PUBLIC_API_URL must have no credentials, query, fragment or trailing slash.',
    );
  }
  const emulator = url.protocol === 'http:' && url.hostname === '10.0.2.2';
  if (profile === 'demo-emulator' && !emulator) {
    throw new Error(
      'demo-emulator requires an HTTP EXPO_PUBLIC_API_URL on 10.0.2.2; use demo for HTTPS.',
    );
  }
  // Unprofiled config evaluation also serves local debug development. Its release
  // native policy remains HTTPS-only; release scripts always select a profile.
  if (
    url.protocol !== 'https:' &&
    !(emulator && (profile === 'demo-emulator' || !env.EPICKEM_BUILD_PROFILE))
  ) {
    throw new Error(
      'This build requires an HTTPS EXPO_PUBLIC_API_URL; only demo-emulator allows HTTP to 10.0.2.2.',
    );
  }
  return profile;
}

module.exports = { loadRootEnvironment, validateApiEnvironment };
