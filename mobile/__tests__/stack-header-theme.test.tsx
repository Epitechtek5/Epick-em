import { render } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { isValidElement, type ComponentProps } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AuthenticatedLayout from '../src/app/(authenticated)/_layout';
import { useAuth } from '../src/features/auth/session';
import { colors } from '../src/theme/colors';

jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('nativewind', () => ({ useColorScheme: jest.fn() }));
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Redirect: () => null,
    Stack: Object.assign(
      jest.fn(
        ({
          children,
          screenOptions,
        }: {
          children: React.ReactNode;
          screenOptions: { headerBackground?: () => React.ReactNode };
        }) =>
          React.createElement(
            View,
            null,
            screenOptions.headerBackground?.(),
            children,
          ),
      ),
      {
        Screen: jest.fn(() => null),
      },
    ),
  };
});

beforeEach(() => {
  jest.mocked(useAuth).mockReturnValue({
    user: {
      id: '22222222-2222-4222-8222-222222222222',
      username: 'alice',
      role: 'admin',
    },
    token: 'test-token',
    initializing: false,
    signIn: jest.fn(),
    logout: jest.fn(),
    refreshUser: jest.fn(),
    clearSession: jest.fn(),
    updateCurrentUser: jest.fn(),
  });
});

function setScheme(scheme: 'light' | 'dark') {
  jest.mocked(useColorScheme).mockReturnValue({
    colorScheme: scheme,
    setColorScheme: jest.fn(),
    toggleColorScheme: jest.fn(),
  });
}

function stackOptions() {
  const props: ComponentProps<typeof Stack> = jest
    .mocked(Stack)
    .mock.calls.at(-1)![0];
  if (!props.screenOptions || typeof props.screenOptions === 'function')
    throw new Error('Expected shared Stack options');
  return props.screenOptions;
}

function expectHeaderScheme(scheme: 'light' | 'dark') {
  const options = stackOptions();
  expect(options.headerTintColor).toBe(colors[scheme].foreground);
  const background = options.headerBackground?.();
  if (
    !isValidElement<{ style: StyleProp<ViewStyle>; pointerEvents: string }>(
      background,
    )
  )
    throw new Error('Expected a native header background');
  expect(background.props.pointerEvents).toBe('none');
  expect(StyleSheet.flatten(background.props.style)).toMatchObject({
    backgroundColor: colors[scheme].card,
    borderBottomColor: colors[scheme].border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  });
}

it.each(['light', 'dark'] as const)(
  'themes the shared details and administration headers in %s mode',
  async (scheme) => {
    setScheme(scheme);
    await render(<AuthenticatedLayout />);
    const options = stackOptions();
    expectHeaderScheme(scheme);
    expect(options.headerShadowVisible).toBe(false);
    // The native Stack still supplies the title, back button and safe-area geometry.
    expect(options.header).toBeUndefined();
    expect(options.headerLeft).toBeUndefined();
    expect(options.headerTransparent).toBeUndefined();
    expect(
      jest.mocked(Stack.Screen).mock.calls.map(([props]) => props.name),
    ).toEqual(expect.arrayContaining(['user/[id]', 'admin/[id]']));
  },
);

it('updates an already mounted Stack when the resolved system or selected scheme changes', async () => {
  setScheme('light');
  const view = await render(<AuthenticatedLayout />);
  expectHeaderScheme('light');
  setScheme('dark');
  await view.rerender(<AuthenticatedLayout />);
  expectHeaderScheme('dark');
  setScheme('light');
  await view.rerender(<AuthenticatedLayout />);
  expectHeaderScheme('light');
});
