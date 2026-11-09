import { render, screen, fireEvent, act } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import { AccessibilityInfo, Keyboard, View } from 'react-native';
import { PasswordInput } from '../src/components/ui/password-input';
import { Input } from '../src/components/ui/input';
import { Button } from '../src/components/ui/button';
import { Text } from '../src/components/ui/text';
import { AccountEditor } from '../src/components/account-editor';
import { UserForm } from '../src/components/users/user-form';
import i18n from '../src/i18n';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('keeps passwords masked initially and toggles visibility without changing the value', async () => {
  const change = jest.fn();
  await render(
    <PasswordInput
      accessibilityLabel="Password"
      value="private-value"
      onChangeText={change}
    />,
  );
  expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
  await fireEvent.press(screen.getByLabelText('Show Password'));
  expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(false);
  expect(screen.getByLabelText('Password').props.value).toBe('private-value');
  await fireEvent.press(screen.getByLabelText('Hide Password'));
  expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
  expect(change).not.toHaveBeenCalled();
});

it('does not expose a visibility control for disabled password input', async () => {
  await render(
    <PasswordInput
      accessibilityLabel="Password"
      value="private-value"
      editable={false}
    />,
  );
  await fireEvent.press(screen.getByLabelText('Show Password'));
  expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
});

it('shows input focus and validation states while preserving consumer callbacks', async () => {
  const focus = jest.fn();
  const blur = jest.fn();
  const view = await render(
    <Input accessibilityLabel="Username" onFocus={focus} onBlur={blur} />,
  );
  await fireEvent(screen.getByLabelText('Username'), 'focus', {});
  expect(screen.getByLabelText('Username').props.className).toContain(
    'border-ring',
  );
  expect(focus).toHaveBeenCalledTimes(1);
  await view.rerender(
    <Input
      accessibilityLabel="Username"
      invalid
      onFocus={focus}
      onBlur={blur}
    />,
  );
  expect(screen.getByLabelText('Username').props.className).toContain(
    'border-destructive',
  );
  await fireEvent(screen.getByLabelText('Username'), 'blur', {});
  expect(blur).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Username').props.className).toContain(
    'border-destructive',
  );
});

it('discloses the account form accessibly and retains unsaved edits when collapsed', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  const save = jest.fn().mockResolvedValue(undefined);
  await render(
    <AccountEditor>
      <UserForm
        user={{
          id: '22222222-2222-4222-8222-222222222222',
          username: 'alice',
          role: 'user',
        }}
        onSave={save}
      />
    </AccountEditor>,
  );
  expect(
    screen.getByLabelText('Edit account').props.accessibilityState,
  ).toMatchObject({
    expanded: false,
  });
  expect(screen.queryByLabelText('Username')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Edit account'));
  await fireEvent.changeText(screen.getByLabelText('Username'), 'renamed');
  await fireEvent.press(screen.getByLabelText('Edit account'));
  expect(screen.queryByLabelText('Username')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Edit account'));
  expect(screen.getByLabelText('Username').props.value).toBe('renamed');
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
});

it.each([false, true])(
  'preserves press behavior with reduced motion %s and avoids scaling when enabled',
  async (reducedMotion) => {
    jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(reducedMotion);
    const timing = jest.spyOn(Reanimated, 'withTiming');
    const press = jest.fn();
    await render(
      <View>
        <Button accessibilityLabel="Continue" onPress={press}>
          <Text>Continue</Text>
        </Button>
      </View>,
    );
    await fireEvent(screen.getByLabelText('Continue'), 'pressIn', {});
    expect(timing).toHaveBeenLastCalledWith(
      reducedMotion ? 1 : 0.98,
      expect.objectContaining({ reduceMotion: Reanimated.ReduceMotion.System }),
    );
    await fireEvent(screen.getByLabelText('Continue'), 'pressOut', {});
    expect(timing).toHaveBeenLastCalledWith(1, expect.any(Object));
    await fireEvent.press(screen.getByLabelText('Continue'));
    expect(press).toHaveBeenCalledTimes(1);
  },
);

it('reacts to reduced-motion changes while the app is open', async () => {
  jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
  const subscribe = jest.spyOn(AccessibilityInfo, 'addEventListener');
  const timing = jest.spyOn(Reanimated, 'withTiming');
  await render(
    <Button accessibilityLabel="Continue">
      <Text>Continue</Text>
    </Button>,
  );
  const listener = subscribe.mock.calls.find(
    ([event]) => event === 'reduceMotionChanged',
  )?.[1];
  expect(listener).toBeDefined();
  await act(async () => {
    listener?.(true);
  });
  await fireEvent(screen.getByLabelText('Continue'), 'pressIn', {});
  expect(timing).toHaveBeenLastCalledWith(1, expect.any(Object));
});
