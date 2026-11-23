import type { Tournament, TournamentAccess } from './types'

// Droits déduits de la session quand GET /tournaments/{id}/access est indisponible (serveur
// plus ancien, réseau) : administrateur global, ou propriétaire d'après `owner_id`. Le serveur
// reste juge de chaque action.
export function fallbackAccess(
  isAdmin: boolean,
  userId: string | null,
  tournament: Pick<Tournament, 'owner_id'> | null,
): TournamentAccess {
  const owner = Boolean(userId && tournament?.owner_id && tournament.owner_id === userId)
  return {
    role: owner ? 'owner' : null,
    global_admin: isAdmin,
    can_manage: isAdmin || owner,
    can_referee: isAdmin || owner,
    can_assign_roles: isAdmin || owner,
    can_duplicate: isAdmin,
  }
}

export const NO_ACCESS: TournamentAccess = {
  role: null,
  global_admin: false,
  can_manage: false,
  can_referee: false,
  can_assign_roles: false,
  can_duplicate: false,
}

// Réponse de GET /tournaments/{id}/access, ou null si elle n'a pas la forme attendue (serveur
// plus ancien, proxy mal configuré) : l'appelant se rabat alors sur fallbackAccess.
export function normalizeAccess(value: unknown): TournamentAccess | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const flags = ['global_admin', 'can_manage', 'can_referee', 'can_assign_roles', 'can_duplicate'] as const
  if (!flags.every((flag) => typeof record[flag] === 'boolean')) return null
  const role = record.role
  return {
    role: role === 'owner' || role === 'admin' || role === 'referee' ? role : null,
    global_admin: record.global_admin as boolean,
    can_manage: record.can_manage as boolean,
    can_referee: record.can_referee as boolean,
    can_assign_roles: record.can_assign_roles as boolean,
    can_duplicate: record.can_duplicate as boolean,
  }
}
