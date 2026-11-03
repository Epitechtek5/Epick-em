import { Copy01Icon } from '@hugeicons/core-free-icons'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { createTournamentTeam, listAllTeams, listTeamMembers } from '@/features/teams/api'
import { teamErrorKey } from '@/features/teams/errors'
import { teamRoleLabelKey } from '@/features/teams/labels'
import { isUuid, ownsTeam } from '@/features/teams/validation'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useUsernames } from '@/hooks/use-usernames'
import { useI18n, type MessageKey } from '@/i18n/context'
import { useAuth } from '@/lib/auth/auth-context'

// Inscription à un tournoi par copie d'une équipe globale possédée par le compte connecté
// (POST /tournaments/{id}/teams avec team_id et member_ids). Le propriétaire est toujours
// copié ; la copie est ensuite indépendante de l'équipe globale.
export default function TournamentTeamCopyPage() {
  const { tournamentId = '' } = useParams()
  const { t } = useI18n()
  useDocumentTitle(t('tournamentTeams.copy'))
  const navigate = useNavigate()
  const { userId } = useAuth()
  const valid = isUuid(tournamentId)

  const teamsState = useAsyncResource(
    (signal) => (valid ? listAllTeams(signal) : Promise.resolve([])),
    [tournamentId],
  )
  const owned =
    teamsState.state.status === 'success'
      ? teamsState.state.data.filter((team) => ownsTeam(team.owner_id, userId))
      : []
  const [teamId, setTeamId] = useState('')
  const source = owned.find((team) => team.id === teamId)

  const membersState = useAsyncResource(
    (signal) => (source ? listTeamMembers(source.id, signal) : Promise.resolve([])),
    [source?.id],
  )
  const active =
    membersState.state.status === 'success' ? membersState.state.data.filter((member) => !member.left_at) : []
  const selectable = active.filter((member) => member.role !== 'owner' && member.user_id !== source?.owner_id)
  const names = useUsernames(active.map((member) => member.user_id))
  // Membres décochés ; vide = tous les membres actifs copiés (état initial).
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)

  function choose(next: string) {
    setTeamId(next)
    setExcluded(new Set())
    setError(null)
  }

  function toggle(id: string) {
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!source || busy || membersState.state.status !== 'success') return
    setBusy(true)
    setError(null)
    try {
      const created = await createTournamentTeam(tournamentId, {
        team_id: source.id,
        member_ids: selectable.filter((member) => !excluded.has(member.user_id)).map((member) => member.user_id),
      })
      navigate(`/tournament-teams/${created.id}`, {
        replace: true,
        state: { notice: { key: 'tournamentTeams.copied', params: { name: created.name } } },
      })
    } catch (caught) {
      setError(teamErrorKey(caught))
      setBusy(false)
    }
  }

  const back = (
    <Link to={`/tournaments/${tournamentId}/teams`} className="text-primary underline underline-offset-4">
      {t('tournamentTeams.returnToList')}
    </Link>
  )

  if (!valid) {
    return (
      <div className="grid w-full max-w-2xl gap-4 self-start">
        <h1 className="text-3xl font-semibold tracking-tight">{t('tournamentTeams.copy')}</h1>
        <StateMessage kind="error">{t('tournamentTeams.errors.invalidTournament')}</StateMessage>
      </div>
    )
  }

  return (
    <div className="grid w-full max-w-2xl gap-6 self-start">
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('tournamentTeams.copy')}</h1>
        <p className="text-muted-foreground">{t('tournamentTeams.copyHint')}</p>
        <p className="text-sm text-muted-foreground">
          {t('tournamentTeams.tournament')} : <span className="break-all font-mono">{tournamentId}</span>
        </p>
        <p>{back}</p>
      </div>

      {error ? <StateMessage kind="error">{t(error)}</StateMessage> : null}

      {teamsState.state.status === 'loading' ? (
        <StateMessage kind="loading">{t('teams.loading')}</StateMessage>
      ) : null}

      {teamsState.state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={teamsState.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(teamErrorKey(teamsState.state.error))}
        </StateMessage>
      ) : null}

      {teamsState.state.status === 'success' && owned.length === 0 ? (
        <StateMessage
          kind="empty"
          action={
            <Link to="/teams/new" className="text-primary underline underline-offset-4">
              {t('teams.create')}
            </Link>
          }
        >
          {t('tournamentTeams.noOwnedTeams')}
        </StateMessage>
      ) : null}

      {owned.length > 0 ? (
        <form onSubmit={submit} aria-busy={busy} className="grid gap-6">
          <div className="grid gap-2">
            <Label htmlFor="copy-source">{t('tournamentTeams.source')}</Label>
            <NativeSelect id="copy-source" value={teamId} onChange={(event) => choose(event.target.value)}>
              <option value="">{t('tournamentTeams.chooseSource')}</option>
              {owned.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.tag ? `${team.name} [${team.tag}]` : team.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          {source && membersState.state.status === 'loading' ? (
            <StateMessage kind="loading">{t('teams.members.loading')}</StateMessage>
          ) : null}

          {source && membersState.state.status === 'error' ? (
            <StateMessage
              kind="error"
              action={
                <Button variant="outline" size="sm" onClick={membersState.reload}>
                  {t('common.retry')}
                </Button>
              }
            >
              {t(teamErrorKey(membersState.state.error))}
            </StateMessage>
          ) : null}

          {source && membersState.state.status === 'success' ? (
            <fieldset className="grid gap-2" aria-describedby="copy-members-hint">
              <legend className="mb-1 text-sm font-medium">{t('tournamentTeams.membersToCopy')}</legend>
              <p id="copy-members-hint" className="text-sm text-muted-foreground">
                {t('tournamentTeams.membersHint')}
              </p>
              {active.map((member) => {
                const isOwner = member.role === 'owner' || member.user_id === source.owner_id
                const inputId = `copy-member-${member.user_id}`
                return (
                  <div key={member.user_id} className="flex items-center gap-2">
                    <input
                      id={inputId}
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={isOwner || !excluded.has(member.user_id)}
                      disabled={isOwner}
                      onChange={() => toggle(member.user_id)}
                    />
                    <Label htmlFor={inputId} className="font-normal">
                      {names[member.user_id] ?? t('teams.unknownUser')} — {t(teamRoleLabelKey(member.role))}
                      {isOwner ? ` (${t('tournamentTeams.ownerKept')})` : ''}
                    </Label>
                  </div>
                )
              })}
            </fieldset>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={!source || busy || membersState.state.status !== 'success'}>
              <Icon icon={Copy01Icon} />
              {busy ? t('tournamentTeams.copying') : t('tournamentTeams.copySubmit')}
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate(`/tournaments/${tournamentId}/teams`)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
