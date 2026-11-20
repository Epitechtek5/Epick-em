import { Outlet, useParams } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { isUuid } from '@/features/teams/validation'
import { useTournamentAccess } from '@/hooks/use-tournament-access'
import { useI18n } from '@/i18n/context'
import { Forbidden } from './AdminRoute'

// Garde d'interface des écrans de gestion d'un tournoi (modification, étapes, matchs) : ouverte
// aux organisateurs du tournoi d'après GET /tournaments/{id}/access (administrateurs globaux,
// propriétaire, administrateurs du tournoi). Un confort seulement : le serveur reste juge.
export function TournamentManagerRoute() {
  const { id, tournamentId } = useParams()
  const target = tournamentId ?? id ?? ''
  const { t } = useI18n()
  const valid = isUuid(target)
  const { access, loading } = useTournamentAccess(valid ? { id: target, owner_id: null } : null)
  // Identifiant invalide : la page affiche elle-même son erreur.
  if (!valid) return <Outlet />
  if (loading && !access.can_manage) {
    return <StateMessage kind="loading">{t('common.loading')}</StateMessage>
  }
  return access.can_manage ? <Outlet /> : <Forbidden />
}
