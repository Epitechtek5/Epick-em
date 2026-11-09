import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { TeamForm } from '@/components/teams/TeamForm'
import { Button } from '@/components/ui/button'
import { createTournamentTeam, getTournamentTeam, updateTournamentTeam } from '@/features/teams/api'
import { teamErrorKey, teamFieldErrors } from '@/features/teams/errors'
import type { TeamFieldErrors, TeamValues } from '@/features/teams/types'
import { changedTeamFields, isUuid, ownsTeam, teamValues, trimmedInput } from '@/features/teams/validation'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

// Création de zéro (/tournaments/:tournamentId/teams/new) et modification
// (/tournament-teams/:id/edit, propriétaire uniquement) d'une équipe de tournoi.
export default function TournamentTeamEditorPage() {
  const { id, tournamentId } = useParams()
  const editing = id !== undefined
  const { t } = useI18n()
  const title = editing ? t('tournamentTeams.edit') : t('tournamentTeams.create')
  useDocumentTitle(title)
  const navigate = useNavigate()
  const { userId } = useAuth()
  const valid = editing ? isUuid(id) : isUuid(tournamentId ?? '')

  const { state, reload } = useAsyncResource(
    (signal) => {
      if (!editing) return Promise.resolve(null)
      return valid ? getTournamentTeam(id, signal) : Promise.reject(new ApiError(404, undefined))
    },
    [id],
  )
  const team = state.status === 'success' ? state.data : null

  const [busy, setBusy] = useState(false)
  const [serverErrors, setServerErrors] = useState<TeamFieldErrors>()
  const [formError, setFormError] = useState<MessageKey | null>(null)
  const [unchanged, setUnchanged] = useState(false)

  const listPath = `/tournaments/${team?.tournament_id ?? tournamentId}/teams`
  const cancel = () => navigate(team ? `/tournament-teams/${team.id}` : listPath)

  async function submit(values: TeamValues) {
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
        const saved = await updateTournamentTeam(team.id, changes)
        navigate(`/tournament-teams/${saved.id}`, {
          replace: true,
          state: { notice: { key: 'tournamentTeams.updated', params: { name: saved.name } } },
        })
      } else if (tournamentId) {
        const created = await createTournamentTeam(tournamentId, trimmedInput(values))
        navigate(`/tournament-teams/${created.id}`, {
          replace: true,
          state: { notice: { key: 'tournamentTeams.created', params: { name: created.name } } },
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

  return (
    <div className="grid w-full max-w-2xl gap-6 self-start">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {!editing && valid ? (
        <p className="text-sm text-muted-foreground">
          {t('tournamentTeams.tournament')} : <span className="break-all font-mono">{tournamentId}</span>
        </p>
      ) : null}

      {!valid ? (
        <StateMessage kind="error">
          {editing ? t('teams.errors.invalidId') : t('tournamentTeams.errors.invalidTournament')}
        </StateMessage>
      ) : null}

      {valid && state.status === 'loading' ? (
        <StateMessage kind="loading">{t('tournamentTeams.loadingDetails')}</StateMessage>
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
        <StateMessage
          kind="error"
          action={
            <Link to={`/tournament-teams/${team.id}`} className="text-primary underline underline-offset-4">
              {t('teams.returnToTeam')}
            </Link>
          }
        >
          {t('teams.errors.notOwner')}
        </StateMessage>
      ) : null}

      {unchanged ? <StateMessage kind="empty">{t('teams.noChanges')}</StateMessage> : null}

      {valid && state.status === 'success' && (!team || ownsTeam(team.owner_id, userId)) ? (
        <TeamForm
          key={team?.id ?? 'new'}
          initial={team ? teamValues(team) : undefined}
          clearHint={Boolean(team)}
          submitLabel={team ? t('common.save') : t('tournamentTeams.create')}
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
