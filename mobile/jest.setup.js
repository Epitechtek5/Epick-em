import { jest } from '@jest/globals';

jest.mock('react-native-reanimated', () =>
  require('react-native-reanimated/mock'),
);
