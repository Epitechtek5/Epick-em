import { fallbackAccess, normalizeAccess } from '@/features/tournaments/access'
import { getTournamentAccess } from '@/features/tournaments/api'
import type { Tournament, TournamentAccess } from '@/features/tournaments/types'
import { useAuth } from '@/lib/auth/auth-context'
import { useAsyncResource } from './use-async-resource'

// Droits du compte connecté sur un tournoi, fournis par le serveur (GET /tournaments/{id}/access) ;
// en attendant (ou si la lecture échoue), droits déduits de la session. Sert uniquement à
// afficher ou masquer des actions : le serveur vérifie chaque requête.
export function useTournamentAccess(tournament: Pick<Tournament, 'id' | 'owner_id'> | null) {
  const { isAdmin, userId } = useAuth()
  const id = tournament?.id
  const { state, reload } = useAsyncResource(
    async (signal) => (id ? normalizeAccess(await getTournamentAccess(id, signal)) : null),
    [id, userId],
  )
  const access: TournamentAccess =
    state.status === 'success' && state.data ? state.data : fallbackAccess(isAdmin, userId, tournament)
  return { access, loading: state.status === 'loading', reload }
}
