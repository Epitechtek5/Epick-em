module.exports = {
  preset: 'jest-expo',
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
