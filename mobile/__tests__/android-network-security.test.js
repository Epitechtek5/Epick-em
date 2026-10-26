import { describe, it, expect } from '@jest/globals';
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const plugin = require('../plugins/with-android-network-security');

describe('Android network security plugin', () => {
  it('attaches the security resource and disables manifest-wide cleartext', async () => {
    const config = plugin(
      { name: 'test', slug: 'test' },
      { profile: 'production' },
    );
    const manifest = {
      manifest: {
        application: [{ $: { 'android:name': '.MainApplication' } }],
      },
    };
    const result = await config.mods.android.manifest({
      modResults: manifest,
      modRequest: { nextMod: async (mod) => mod },
    });
    expect(result.modResults.manifest.application[0].$).toMatchObject({
      'android:networkSecurityConfig': '@xml/epickem_network_security',
      'android:usesCleartextTraffic': 'false',
    });
  });
  it('writes variant resources and removes stale demo permissions on regeneration', () => {
    const directory = mkdtempSync(join(tmpdir(), 'epickem-android-'));
    const read = (variant) =>
      readFileSync(
        join(
          directory,
          `app/src/${variant}/res/xml/epickem_network_security.xml`,
        ),
        'utf8',
      );
    try {
      plugin.writeNetworkSecurity(directory, 'demo-emulator');
      expect(read('main')).toContain(
        '<domain includeSubdomains="false">10.0.2.2</domain>',
      );
      expect(read('main')).not.toContain('localhost');
      expect(read('debug')).toContain('localhost');
      for (const profile of ['demo', 'production']) {
        plugin.writeNetworkSecurity(directory, profile);
        expect(read('main')).toContain(
          '<base-config cleartextTrafficPermitted="false" />',
        );
        expect(read('main')).not.toContain('cleartextTrafficPermitted="true"');
        expect(read('main')).not.toContain('debug-overrides');
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
