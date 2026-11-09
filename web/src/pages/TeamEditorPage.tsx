import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { TeamForm } from '@/components/teams/TeamForm'
import { Button } from '@/components/ui/button'
import { listAllGames } from '@/features/games/api'
import { createTeam, getTeam, updateTeam } from '@/features/teams/api'
import { teamErrorKey, teamFieldErrors } from '@/features/teams/errors'
import type { Game } from '@/features/games/types'
import type { Team, TeamFieldErrors, TeamValues } from '@/features/teams/types'
import { changedTeamFields, isUuid, ownsTeam, teamValues, trimmedInput } from '@/features/teams/validation'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

// Création (/teams/new, tout compte connecté, qui devient propriétaire) et modification
// (/teams/:id/edit, propriétaire uniquement) d'une équipe globale.
export default function TeamEditorPage() {
  const { id } = useParams()
  const editing = id !== undefined
  const { t } = useI18n()
  const title = editing ? t('teams.edit') : t('teams.create')
  useDocumentTitle(title)
  const navigate = useNavigate()
  const { userId } = useAuth()
  const [search] = useSearchParams()
  const valid = !editing || isUuid(id)

  const { state, reload } = useAsyncResource<Team | Game[]>(
    (signal) => {
      if (editing) return valid ? getTeam(id, signal) : Promise.reject(new ApiError(404, undefined))
      return listAllGames(signal)
    },
    [id],
  )

  const [busy, setBusy] = useState(false)
  const [serverErrors, setServerErrors] = useState<TeamFieldErrors>()
  const [formError, setFormError] = useState<MessageKey | null>(null)
  const [unchanged, setUnchanged] = useState(false)

  const cancel = () => navigate(editing ? `/teams/${id}` : '/teams')
  const team = editing && state.status === 'success' && !Array.isArray(state.data) ? state.data : null
  const games = !editing && state.status === 'success' && Array.isArray(state.data) ? state.data : null

  async function submit(values: TeamValues, gameId: string) {
    setBusy(true)
    setServerErrors(undefined)
    setFormError(null)
    setUnchanged(false)
    try {
      if (team) {
        const changes = changedTeamFields(teamValues(team), values)
        if (Object.keys(changes).length === 0) {
          setUnchanged(true)
          return
        }
        const saved = await updateTeam(team.id, changes)
        navigate(`/teams/${saved.id}`, {
          replace: true,
          state: { notice: { key: 'teams.updated', params: { name: saved.name } } },
        })
      } else {
        const created = await createTeam({ game_id: gameId, ...trimmedInput(values) })
        navigate(`/teams/${created.id}`, {
          replace: true,
          state: { notice: { key: 'teams.created', params: { name: created.name } } },
        })
      }
    } catch (error) {
      const fields = teamFieldErrors(error)
      if (fields) setServerErrors(fields)
      else setFormError(teamErrorKey(error))
    } finally {
      setBusy(false)
    }
  }

  const backLink = (
    <Link to="/teams" className="text-primary underline underline-offset-4">
      {t('teams.returnToList')}
    </Link>
  )

  return (
    <div className="grid w-full max-w-2xl gap-6 self-start">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>

      {!valid ? (
        <StateMessage kind="error" action={backLink}>
          {t('teams.errors.invalidId')}
        </StateMessage>
      ) : null}

      {valid && state.status === 'loading' ? (
        <StateMessage kind="loading">{editing ? t('teams.loadingDetails') : t('teams.loadingGames')}</StateMessage>
      ) : null}

      {valid && state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(teamErrorKey(state.error))}
        </StateMessage>
      ) : null}

      {team && !ownsTeam(team.owner_id, userId) ? (
        <StateMessage kind="error" action={<Link to={`/teams/${team.id}`} className="text-primary underline underline-offset-4">{t('teams.returnToTeam')}</Link>}>
          {t('teams.errors.notOwner')}
        </StateMessage>
      ) : null}

      {games && games.length === 0 ? (
        <StateMessage kind="empty" action={backLink}>
          {t('teams.noGames')}
        </StateMessage>
      ) : null}

      {unchanged ? <StateMessage kind="empty">{t('teams.noChanges')}</StateMessage> : null}

      {(team && ownsTeam(team.owner_id, userId)) || (games && games.length > 0) ? (
        <TeamForm
          key={team?.id ?? 'new'}
          initial={team ? teamValues(team) : undefined}
          games={games ?? undefined}
          initialGameId={games?.some((game) => game.id === search.get('game')) ? (search.get('game') ?? '') : ''}
          clearHint={Boolean(team)}
          submitLabel={team ? t('common.save') : t('teams.create')}
          busy={busy}
          serverErrors={serverErrors}
          formError={formError}
          onSubmit={submit}
          onCancel={cancel}
        />
      ) : null}
    </div>
  )
}
