import { fireEvent, render, screen } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Enroll from '../src/screens/auth/EnrollEmailScreen';
import Verify from '../src/screens/auth/VerifyEmailScreen';
import Pending from '../src/screens/auth/VerificationPendingScreen';
import {
  enrollEmail,
  verifyEmail,
  resendVerification,
} from '../src/features/auth/verification';
import { ApiError } from '../src/lib/api';

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(),
  router: { replace: jest.fn() },
}));
jest.mock('../src/features/auth/verification', () => ({
  enrollEmail: jest.fn(),
  verifyEmail: jest.fn(),
  resendVerification: jest.fn(),
}));
beforeEach(() => jest.clearAllMocks());
it.each([undefined, ['ambiguous', 'value']])(
  'handles a missing or ambiguous token',
  async (token) => {
    jest.mocked(useLocalSearchParams).mockReturnValue(token ? { token } : {});
    await render(<Verify />);
    expect(screen.getByText(/This link is missing/)).toBeOnTheScreen();
    expect(verifyEmail).not.toHaveBeenCalled();
  },
);
it('confirms once and offers login without displaying the token', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ token: 'opaque' });
  jest.mocked(verifyEmail).mockResolvedValue();
  await render(<Verify />);
  expect(
    await screen.findByText('Email confirmed. You can now sign in.'),
  ).toBeOnTheScreen();
  expect(verifyEmail).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('opaque')).toBeNull();
});
it('offers resend after an expired or consumed link', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ token: 'expired' });
  jest.mocked(verifyEmail).mockRejectedValue(new ApiError(400, 'fixture'));
  await render(<Verify />);
  expect(await screen.findByText(/This link is missing/)).toBeOnTheScreen();
  expect(screen.getByText('Resend verification email')).toBeOnTheScreen();
});
it('submits normalized email and starts a resend cooldown', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ email: ' ALICE@example.com ' });
  jest.mocked(resendVerification).mockResolvedValue();
  await render(<Pending />);
  await fireEvent.press(screen.getByText('Resend verification email'));
  expect(resendVerification).toHaveBeenCalledWith('alice@example.com');
  expect(
    await screen.findByText(/If this address is eligible/),
  ).toBeOnTheScreen();
  expect(screen.getByText(/Resend verification email \(60\)/)).toBeDisabled();
});
it('handles resend errors and allows retry', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ email: 'alice@example.com' });
  jest.mocked(resendVerification).mockRejectedValue(new Error('private'));
  await render(<Pending />);
  await fireEvent.press(screen.getByText('Resend verification email'));
  expect(
    await screen.findByText('The request failed. Please try again.'),
  ).toBeOnTheScreen();
  expect(screen.getByText('Resend verification email')).toBeEnabled();
});

it('enrolls a historical account without forwarding its password to navigation', async () => {
  jest.mocked(enrollEmail).mockResolvedValue();
  await render(<Enroll />);
  await fireEvent.changeText(screen.getByLabelText('Username'), 'legacy');
  await fireEvent.changeText(
    screen.getByLabelText('Email address'),
    ' Legacy@Example.com ',
  );
  await fireEvent.changeText(screen.getByLabelText('Password'), 'Password123!');
  await fireEvent(screen.getByLabelText('Password'), 'submitEditing');
  expect(enrollEmail).toHaveBeenCalledWith(
    'legacy',
    'Password123!',
    'legacy@example.com',
  );
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/verification-pending',
    params: { email: 'legacy@example.com', cooldown: '1' },
  });
});
