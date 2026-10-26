const {
  loadRootEnvironment,
  validateApiEnvironment,
} = require('./config/environment');

loadRootEnvironment();
const profile = validateApiEnvironment();

module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins || []),
    'expo-secure-store',
    'expo-localization',
    ['./plugins/with-android-network-security', { profile }],
  ],
});
