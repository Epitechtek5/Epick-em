module.exports = {
  preset: 'jest-expo',
  resolver: require.resolve('react-native-reanimated/jest/resolver'),
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns:
    require('jest-expo/jest-preset').transformIgnorePatterns.map((pattern) =>
      pattern.replace(
        '.pnpm|react-native',
        '.pnpm|@rn-primitives|react-native',
      ),
    ),
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  clearMocks: true,
};
