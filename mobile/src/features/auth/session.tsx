import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import type { User } from './types';

interface AuthSession {
  token: string | null;
  user: User | null;
  setAuthenticatedSession: (token: string, user: User) => void;
  updateCurrentUser: (user: User) => void;
  clearSession: () => void;
}

const AuthContext = createContext<AuthSession | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  const setAuthenticatedSession = useCallback(
    (accessToken: string, authenticatedUser: User) => {
      if (!accessToken) {
        throw new Error('An access token is required');
      }

      setToken(accessToken);
      setUser(authenticatedUser);
    },
    [],
  );

  const updateCurrentUser = useCallback((updatedUser: User) => {
    setUser((previous) => {
      if (!previous || previous.id !== updatedUser.id) {
        return previous;
      }

      return updatedUser;
    });
  }, []);

  const clearSession = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      token,
      user,
      setAuthenticatedSession,
      updateCurrentUser,
      clearSession,
    }),
    [token, user, setAuthenticatedSession, updateCurrentUser, clearSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthSession {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
