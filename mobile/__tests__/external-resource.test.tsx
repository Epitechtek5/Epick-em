import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { useGameResource } from '../src/features/games/use-game-resource';
import { useAuth } from '../src/features/auth/session';
import { TournamentSourceContext } from '../src/features/tournaments/source-context';
import type { TournamentSource } from '../src/features/tournaments/external';
import { ApiError } from '../src/lib/api';

jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    jest.requireActual('react').useEffect(effect, [effect]);
  },
}));
const refreshUser = jest.fn(async () => undefined);
const source: TournamentSource = {
  id: 'source',
  provider: 'fake',
  provider_name: 'Example',
  url: null,
  last_success_at: null,
  stale: false,
  capabilities: {},
  snapshot: null,
};
function wrapper({ children }: { children: ReactNode }) {
  return (
    <TournamentSourceContext.Provider value={source}>
      {children}
    </TournamentSourceContext.Provider>
  );
}
beforeEach(() => {
  jest.mocked(useAuth).mockReturnValue({
    user: { id: 'one' },
    token: 'token',
    refreshUser,
  } as unknown as ReturnType<typeof useAuth>);
});

it('retains data only for temporary failures and discards denied data', async () => {
  const load = jest
    .fn<Promise<{ name: string }>, [string]>()
    .mockResolvedValue({ name: 'Cached result' });
  const { result } = await renderHook(() => useGameResource(load), { wrapper });
  await waitFor(() => expect(result.current.data?.name).toBe('Cached result'));
  load.mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    await result.current.reload(true);
  });
  expect(result.current.data?.name).toBe('Cached result');
  expect(result.current.error).toBeTruthy();
  load.mockRejectedValueOnce(new ApiError(403, 'denied'));
  await act(async () => {
    await result.current.reload(true);
  });
  expect(result.current.data).toBeNull();
});

it('never reuses another resource cache', async () => {
  const first = jest.fn(async () => 'first resource');
  const second = jest.fn(async () => {
    throw new Error('offline');
  });
  const { result, rerender } = await renderHook(
    ({ load }: { load: (token: string) => Promise<string> }) =>
      useGameResource(load),
    {
      initialProps: { load: first as (token: string) => Promise<string> },
      wrapper,
    },
  );
  await waitFor(() => expect(result.current.data).toBe('first resource'));
  await rerender({ load: second });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data).toBeNull();
});
