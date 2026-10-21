import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  loadRootEnvironment,
  validateApiEnvironment,
} = require('../config/environment');

describe('mobile environment', () => {
  let directory;
  let filename;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'epickem-env-'));
    filename = join(directory, '.env');
    writeFileSync(
      filename,
      'EXPO_PUBLIC_API_URL=http://10.0.2.2:8080\nDATABASE_URL=secret\nEXPO_PUBLIC_OTHER=ignored\n',
    );
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('loads only the public API URL from the root file', () => {
    const env = {};
    loadRootEnvironment({ env, filename });
    expect(env).toEqual({ EXPO_PUBLIC_API_URL: 'http://10.0.2.2:8080' });
  });
  it.each([
    { CI: '1' },
    { NODE_ENV: 'test' },
    { EXPO_NO_DOTENV: '1' },
    { EXPO_PUBLIC_API_URL: 'https://api.example.test' },
  ])('preserves explicit values and isolates CI/tests: %j', (env) => {
    const original = { ...env };
    loadRootEnvironment({ env, filename });
    expect(env).toEqual(original);
  });
  it('requires a URL for artifact builds', () => {
    expect(() => validateApiEnvironment({}, { required: true })).toThrow(
      'EXPO_PUBLIC_API_URL is required',
    );
  });
  it.each(['demo', 'production'])('rejects HTTP in %s', (profile) => {
    expect(() =>
      validateApiEnvironment({
        EPICKEM_BUILD_PROFILE: profile,
        EXPO_PUBLIC_API_URL: 'http://10.0.2.2:8080',
      }),
    ).toThrow('HTTPS');
    expect(
      validateApiEnvironment({
        EPICKEM_BUILD_PROFILE: profile,
        EXPO_PUBLIC_API_URL: 'https://api.example.test',
      }),
    ).toBe(profile);
  });
  it('limits the emulator demo exception to the emulator host', () => {
    const env = {
      EPICKEM_BUILD_PROFILE: 'demo-emulator',
      EXPO_PUBLIC_API_URL: 'http://10.0.2.2:8080',
    };
    expect(validateApiEnvironment(env)).toBe('demo-emulator');
    expect(() =>
      validateApiEnvironment({
        ...env,
        EXPO_PUBLIC_API_URL: 'http://192.168.1.2:8080',
      }),
    ).toThrow('10.0.2.2');
    expect(() =>
      validateApiEnvironment({
        ...env,
        EXPO_PUBLIC_API_URL: 'https://api.example.test',
      }),
    ).toThrow('use demo for HTTPS');
  });
  it.each([
    'bad',
    'https://user:secret@example.test',
    'https://example.test/',
    'https://example.test?token=secret',
  ])('rejects an invalid base URL: %s', (value) => {
    expect(() =>
      validateApiEnvironment({ EXPO_PUBLIC_API_URL: value }),
    ).toThrow();
  });
});
