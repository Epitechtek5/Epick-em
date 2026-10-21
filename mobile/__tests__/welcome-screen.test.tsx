import { render, screen } from '@testing-library/react-native';

import WelcomeScreen from '@/components/welcome-screen';

it('presents the application name as a heading and explains the starter state', async () => {
  await render(<WelcomeScreen />);

  expect(screen.getByRole('header', { name: 'Epick’em' })).toBeOnTheScreen();
  expect(
    screen.getByText('The mobile application is ready for development.'),
  ).toBeOnTheScreen();
});
