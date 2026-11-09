import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { TeamMembersSection } from '@/components/teams/TeamMembersSection'
import { TeamOverview } from '@/components/teams/TeamOverview'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { readNotice } from '@/features/games/notice'
import { deleteTournamentTeam, getTournamentTeam } from '@/features/teams/api'
import { teamErrorKey } from '@/features/teams/errors'
import { isUuid, ownsTeam } from '@/features/teams/validation'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useUsernames } from '@/hooks/use-usernames'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

// Fiche d'une équipe de tournoi (GET /tournament-teams/{id}) et de ses membres. Une copie
// reste indépendante de l'équipe globale d'origine : rien n'est modifié de ce côté.
export default function TournamentTeamDetailsPage() {
  const { id = '' } = useParams()
  const { t } = useI18n()
  const { userId } = useAuth()
  const navigate = useNavigate()
  const notice = readNotice(useLocation().state)
  const valid = isUuid(id)

  const { state, reload } = useAsyncResource(
    (signal) => (valid ? getTournamentTeam(id, signal) : Promise.reject(new ApiError(404, undefined))),
    [id],
  )
  const team = state.status === 'success' ? state.data : null
  useDocumentTitle(team?.name ?? t('tournamentTeams.details'))
  const owners = useUsernames(team ? [team.owner_id] : [])
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<MessageKey | null>(null)
  const canManage = ownsTeam(team?.owner_id, userId)

  async function remove() {
    if (!team) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteTournamentTeam(team.id)
      navigate(`/tournaments/${team.tournament_id}/teams`, {
        replace: true,
        state: { notice: { key: 'tournamentTeams.deleted', params: { name: team.name } } },
      })
    } catch (error) {
      setDeleteError(teamErrorKey(error))
      setDeleting(false)
    }
  }

  if (!valid) {
    return (
      <div className="grid w-full max-w-5xl gap-4 self-start">
        <h1 className="text-3xl font-semibold tracking-tight">{t('tournamentTeams.details')}</h1>
        <StateMessage kind="error">{t('teams.errors.invalidId')}</StateMessage>
      </div>
    )
  }

  return (
    <div className="grid w-full max-w-5xl gap-8 self-start">
      {team ? (
        <div>
          <Link
            to={`/tournaments/${team.tournament_id}/teams`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Icon icon={ArrowLeft01Icon} />
            {t('tournamentTeams.returnToList')}
          </Link>
        </div>
      ) : null}

      {notice ? <StateMessage kind="success">{t(notice.key, notice.params)}</StateMessage> : null}

      {state.status === 'loading' ? (
        <StateMessage kind="loading">{t('tournamentTeams.loadingDetails')}</StateMessage>
      ) : null}

      {state.status === 'error' ? (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">{t('tournamentTeams.details')}</h1>
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
        </>
      ) : null}

      {team ? (
        <>
          <TeamOverview
            name={team.name}
            tag={team.tag}
            pictureUrl={team.picture_url}
            details={[
              { label: t('tournamentTeams.kind'), value: t('tournamentTeams.kindValue') },
              {
                label: t('tournamentTeams.tournament'),
                value: (
                  <Link to={`/tournaments/${team.tournament_id}`} className="font-mono text-primary underline underline-offset-4">
                    {team.tournament_id}
                  </Link>
                ),
              },
              {
                label: t('teams.owner'),
                value: `${owners[team.owner_id] ?? t('teams.unknownUser')}${canManage ? ` (${t('teams.you')})` : ''}`,
              },
              {
                label: t('tournamentTeams.origin'),
                value: team.team_id ? (
                  <Link to={`/teams/${team.team_id}`} className="text-primary underline underline-offset-4">
                    {t('tournamentTeams.copiedFrom')}
                  </Link>
                ) : (
                  t('tournamentTeams.fromScratch')
                ),
              },
            ]}
            canManage={canManage}
            editTo={`/tournament-teams/${team.id}/edit`}
            deleteLabels={{
              label: t('tournamentTeams.delete'),
              busy: t('teams.deleting'),
              title: t('tournamentTeams.confirmDeleteTitle'),
              description: t('tournamentTeams.confirmDelete', { name: team.name }),
            }}
            deleting={deleting}
            deleteError={deleteError}
            onDelete={remove}
            onRefresh={reload}
          />
          {team.team_id ? <p className="text-sm text-muted-foreground">{t('tournamentTeams.independent')}</p> : null}
          {!canManage ? <p className="text-sm text-muted-foreground">{t('teams.readOnly')}</p> : null}
          <TeamMembersSection scope="tournament" teamId={team.id} ownerId={team.owner_id} canManage={canManage} />
        </>
      ) : null}
    </div>
  )
}
