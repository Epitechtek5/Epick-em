const { loadRootEnvironment } = require('./config/environment');

// Metro also runs in the Gradle bundling process, independently of app config.
loadRootEnvironment();

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, {
  input: './global.css',
  inlineRem: 16,
});
