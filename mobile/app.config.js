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
            {
              action: 'VIEW',
              autoVerify: true,
              data: [
                {
                  scheme: 'https',
                  host: linkHost,
                  pathPrefix: '/reset-password',
                },
              ],
              category: ['BROWSABLE', 'DEFAULT'],
            },
          ],
        }
      : {}),
  },
  plugins: [
    ...(config.plugins || []),
    'expo-secure-store',
    'expo-localization',
    '@react-native-community/datetimepicker',
    ['./plugins/with-android-network-security', { profile }],
  ],
});
