import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/features/auth/session';
import { useTournamentSource } from '@/features/tournaments/source-context';
import { ApiError } from '@/lib/api';
import { gameErrorKey } from './errors';

export function useGameResource<T>(
  load: (token: string) => Promise<T>,
  errorKey: (error: unknown) => string = gameErrorKey,
) {
  const { token, refreshUser, user } = useAuth();
  const source = useTournamentSource();
  const retain = Boolean(source);
  const tokenRef = useRef(token);
  const retainedScope = useRef({
    userId: user?.id,
    load,
    synchronizedAt: source?.last_success_at,
  });
  const generation = useRef(0);
  const pending = useRef<Promise<void> | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const reload = useCallback(
    (refresh = false): Promise<void> => {
      if (pending.current) return pending.current;
      const requestGeneration = generation.current;
      const accessToken = tokenRef.current;
      if (!accessToken) return Promise.resolve();
      setLoading(true);
      setRefreshing(refresh);
      setError('');
      const operation = (async () => {
        try {
          const result = await Promise.resolve().then(() => load(accessToken));
          if (generation.current === requestGeneration) setData(result);
        } catch (caught) {
          if (generation.current === requestGeneration) {
            if (
              caught instanceof ApiError &&
              [401, 403, 404].includes(caught.status)
            )
              setData(null);
            setError(errorKey(caught));
          }
        } finally {
          if (generation.current === requestGeneration) {
            setLoading(false);
            setRefreshing(false);
            pending.current = null;
          }
        }
      })();
      pending.current = operation;
      return operation;
    },
    [load, errorKey],
  );

  useFocusEffect(
    useCallback(() => {
      if (
        !retain ||
        retainedScope.current.userId !== user?.id ||
        retainedScope.current.load !== load
      )
        setData(null);
      retainedScope.current = {
        userId: user?.id,
        load,
        synchronizedAt: source?.last_success_at,
      };
      void reload();
      void refreshUser().catch(() => undefined);
      return () => {
        // A response from a previous page, route or session must never replace this one.
        generation.current++;
        pending.current = null;
      };
    }, [reload, refreshUser, retain, user?.id, source?.last_success_at, load]),
  );

  return { data, loading, refreshing, error, reload, setData };
}
