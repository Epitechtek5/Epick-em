import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/session';
import { listTournamentRoles } from './api';
import type { TournamentRole } from './types';

export function useTournamentAccess(tournamentId: string) {
  const { token, user } = useAuth();
  const [role, setRole] = useState<'owner' | TournamentRole | null>(null);

  useEffect(() => {
    if (!token || !user || user.role === 'admin') return;
    let active = true;
    void Promise.resolve()
      .then(() => listTournamentRoles(token, tournamentId))
      .then(
        (roles) => {
          if (!active) return;
          if (!roles) {
            setRole(null);
            return;
          }
          if (roles.owner_id === user.id) setRole('owner');
          else
            setRole(
              roles.roles.find((assignment) => assignment.user_id === user.id)
                ?.role ?? null,
            );
        },
        () => {
          if (active) setRole(null);
        },
      );
    return () => {
      active = false;
    };
  }, [token, tournamentId, user]);

  return {
    role: user?.role === 'admin' ? 'owner' : role,
    canManage: user?.role === 'admin' || role === 'owner' || role === 'admin',
    canReferee:
      user?.role === 'admin' ||
      role === 'owner' ||
      role === 'admin' ||
      role === 'referee',
  };
}
