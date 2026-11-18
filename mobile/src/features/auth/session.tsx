import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { configureSessionRequest } from '@/lib/api';
import { revokeCurrentPushToken } from '@/features/notifications/registration';
import { SessionClient } from './client';
import type { AccountUser, LoginRequest } from './types';

interface AuthSession {
  token: string | null;
  user: AccountUser | null;
  initializing: boolean;
  signIn: (credentials: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateCurrentUser: (user: AccountUser) => void;
  clearSession: () => Promise<void>;
}
const AuthContext = createContext<AuthSession | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [, rerender] = useState(0);
  const [client] = useState(
    () =>
      new SessionClient((session) => {
        if (!session) setUser(null);
        rerender((value) => value + 1);
      }),
  );

  const refreshUser = useCallback(async () => {
    if (client.session) setUser(await client.currentUser());
  }, [client]);

  useEffect(() => {
    configureSessionRequest(client.request);
    void (async () => {
      try {
        await client.restore();
        if (client.session) setUser(await client.currentUser());
      } catch {
        await client.clear().catch(() => undefined);
      } finally {
        setInitializing(false);
      }
    })();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && client.session) {
        void client
          .currentUser()
          .then(setUser)
          .catch(() => undefined);
      }
    });
    return () => {
      configureSessionRequest(null);
      subscription.remove();
    };
  }, [client]);

  return (
    <AuthContext.Provider
      value={{
        token: client.session?.access_token ?? null,
        user,
        initializing,
        async signIn(credentials) {
          try {
            await client.authenticate(credentials);
            setUser(await client.currentUser());
          } catch (error) {
            await client.clear();
            throw error;
          }
        },
        async logout() {
          await revokeCurrentPushToken().catch(() => undefined);
          await client.logout();
        },
        refreshUser,
        updateCurrentUser: setUser,
        async clearSession() {
          await revokeCurrentPushToken().catch(() => undefined);
          await client.clear();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthSession {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
