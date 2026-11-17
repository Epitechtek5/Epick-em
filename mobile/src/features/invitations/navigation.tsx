import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import type { Href } from 'expo-router';
import { useAuth } from '@/features/auth/session';
import { validInvitationToken, type InvitationType } from './api';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function invitationTarget(path: unknown): Href | null {
  if (typeof path !== 'string') return null;
  const parts = path.split('/');
  if (parts.length !== 3 || parts[0] !== '') return null;
  if (parts[1] === 'invite' && validInvitationToken(parts[2]))
    return { pathname: '/invite/[token]', params: { token: parts[2] } };
  if (parts[1] === 'invitations' && uuid.test(parts[2]))
    return { pathname: '/invitations/[id]', params: { id: parts[2] } };
  return null;
}
export function resourceTarget(type: InvitationType, id: string): Href {
  if (type === 'team')
    return { pathname: '/(authenticated)/teams/[id]', params: { id } };
  if (type === 'tournament_team')
    return {
      pathname: '/(authenticated)/tournament-teams/[id]',
      params: { id },
    };
  return {
    pathname: '/(authenticated)/tournaments/[tournamentId]',
    params: { tournamentId: id },
  };
}
const InvitationReturnContext = createContext<{
  target: Href | null;
  remember: (path: string) => void;
  clear: () => void;
}>({ target: null, remember: () => {}, clear: () => {} });
export function InvitationReturnProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const previousAccount = useRef(user?.id);
  const [pending, setPending] = useState<{
    path: string;
    expires: number;
  } | null>(null);
  useEffect(() => {
    if (previousAccount.current && previousAccount.current !== user?.id)
      setPending(null);
    previousAccount.current = user?.id;
  }, [user?.id]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(
      () => setPending(null),
      Math.max(0, pending.expires - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [pending]);
  const remember = useCallback((path: string) => {
    if (invitationTarget(path))
      setPending({ path, expires: Date.now() + 30 * 60_000 });
  }, []);
  const clear = useCallback(() => setPending(null), []);
  // Keep link secrets in memory; signing out or switching accounts discards them.
  const target = pending ? invitationTarget(pending.path) : null;
  return (
    <InvitationReturnContext.Provider
      value={{
        target,
        remember,
        clear,
      }}
    >
      {children}
    </InvitationReturnContext.Provider>
  );
}
export const useInvitationReturn = () => useContext(InvitationReturnContext);
export function useInvitationLifetime() {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return active;
}
