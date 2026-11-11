import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  loadRootEnvironment,
  validateApiEnvironment,
  validatePublicUrl,
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

  it('loads only mobile-safe public URLs from the root file', () => {
    const env = {};
    loadRootEnvironment({ env, filename });
    expect(env).toEqual({ EXPO_PUBLIC_API_URL: 'http://10.0.2.2:8080' });
  });
  it('loads PUBLIC_URL for native link configuration without importing secrets', () => {
    writeFileSync(
      filename,
      'EXPO_PUBLIC_API_URL=https://api.example.test\nPUBLIC_URL=https://app.example.test\nRESEND_API_KEY=secret\n',
    );
    const env = {};
    loadRootEnvironment({ env, filename });
    expect(env).toEqual({
      EXPO_PUBLIC_API_URL: 'https://api.example.test',
      PUBLIC_URL: 'https://app.example.test',
    });
  });
  it('loads the public EAS project identifier without importing Expo secrets', () => {
    writeFileSync(
      filename,
      'EXPO_PUBLIC_API_URL=https://api.example.test\nEXPO_PUBLIC_EAS_PROJECT_ID=22222222-2222-4222-8222-222222222222\nEXPO_ACCESS_TOKEN=secret\n',
    );
    const env = {};
    loadRootEnvironment({ env, filename });
    expect(env).toEqual({
      EXPO_PUBLIC_API_URL: 'https://api.example.test',
      EXPO_PUBLIC_EAS_PROJECT_ID: '22222222-2222-4222-8222-222222222222',
    });
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
  it('accepts only an HTTPS origin for verified app links', () => {
    expect(validatePublicUrl({ PUBLIC_URL: 'https://app.example.test' })).toBe(
      'app.example.test',
    );
    expect(
      validatePublicUrl({ PUBLIC_URL: 'http://localhost:3000' }),
    ).toBeNull();
    expect(() =>
      validatePublicUrl(
        { PUBLIC_URL: 'http://localhost:3000' },
        { required: true },
      ),
    ).toThrow('HTTPS');
    expect(() =>
      validatePublicUrl({ PUBLIC_URL: 'https://app.example.test/reset' }),
    ).toThrow('origin');
  });
});
