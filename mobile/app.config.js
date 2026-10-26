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
    ['./plugins/with-android-network-security', { profile }],
  ],
});
