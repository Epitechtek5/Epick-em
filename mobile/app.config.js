const {
  loadRootEnvironment,
  validateApiEnvironment,
  validatePublicUrl,
} = require('./config/environment');

loadRootEnvironment();
const profile = validateApiEnvironment();
const linkHost = validatePublicUrl(process.env, {
  required: process.env.EPICKEM_BUILD_PROFILE === 'production',
});

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    eas: {
      ...config.extra?.eas,
      ...(process.env.EXPO_PUBLIC_EAS_PROJECT_ID
        ? { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID }
        : {}),
    },
  },
  ios: {
    ...config.ios,
    ...(linkHost
      ? {
          associatedDomains: [
            ...(config.ios?.associatedDomains || []),
            `applinks:${linkHost}`,
          ],
        }
      : {}),
  },
  android: {
    ...config.android,
    ...(linkHost
      ? {
          intentFilters: [
            ...(config.android?.intentFilters || []),
            ...['/reset-password', '/verify-email'].map((path) => ({
              action: 'VIEW',
              autoVerify: true,
              data: [
                {
                  scheme: 'https',
                  host: linkHost,
                  ...(path === '/reset-password'
                    ? { pathPrefix: path }
                    : { path }),
                },
              ],
              category: ['BROWSABLE', 'DEFAULT'],
            })),
          ],
        }
      : {}),
  },
  plugins: [
    ...(config.plugins || []),
    'expo-secure-store',
    'expo-localization',
    'expo-notifications',
    '@react-native-community/datetimepicker',
    ['./plugins/with-android-network-security', { profile }],
  ],
});
