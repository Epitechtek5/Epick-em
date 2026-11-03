import { fireEvent, render, screen } from '@testing-library/react-native';
import { StepOptionSelect } from '../src/components/steps/option-select';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

it('opens the stage format dropdown and selects an option', async () => {
  const onSelect = jest.fn();

  await render(
    <StepOptionSelect
      label="Format"
      value="pool"
      options={['pool', 'swiss', 'single_elim']}
      labelFor={(value) =>
        ({
          pool: 'Groups',
          swiss: 'Swiss',
          single_elim: 'Single elimination',
        })[value]
      }
      onSelect={onSelect}
    />,
  );

  await fireEvent.press(screen.getByLabelText('Format: Groups'));
  const swiss = await screen.findByRole('radio', { name: 'Swiss' });
  await fireEvent.press(swiss);

  expect(onSelect).toHaveBeenCalledWith('swiss');
  expect(screen.queryByRole('radio', { name: 'Swiss' })).toBeNull();
});
