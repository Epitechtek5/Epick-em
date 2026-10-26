const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require('expo/config-plugins');

function networkSecurityXml(hosts = []) {
  return `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
${
  hosts.length
    ? `  <domain-config cleartextTrafficPermitted="true">
${hosts.map((host) => `    <domain includeSubdomains="false">${host}</domain>`).join('\n')}
  </domain-config>\n`
    : ''
}</network-security-config>
`;
}

function writeNetworkSecurity(projectRoot, profile) {
  for (const [sourceSet, hosts] of [
    ['main', profile === 'demo-emulator' ? ['10.0.2.2'] : []],
    // Debug resources override main resources. Loopback supports adb reverse / Metro.
    ['debug', ['10.0.2.2', 'localhost', '127.0.0.1']],
  ]) {
    const directory = path.join(projectRoot, 'app/src', sourceSet, 'res/xml');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, 'epickem_network_security.xml'),
      networkSecurityXml(hosts),
    );
  }
}

module.exports = function withAndroidNetworkSecurity(config, { profile }) {
  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      mod.modResults,
    );
    application.$['android:networkSecurityConfig'] =
      '@xml/epickem_network_security';
    application.$['android:usesCleartextTraffic'] = 'false';
    return mod;
  });
  return withDangerousMod(config, [
    'android',
    (mod) => {
      writeNetworkSecurity(mod.modRequest.platformProjectRoot, profile);
      return mod;
    },
  ]);
};
module.exports.networkSecurityXml = networkSecurityXml;
module.exports.writeNetworkSecurity = writeNetworkSecurity;
