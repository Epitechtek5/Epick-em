import { ArrowLeft01Icon, ChampionIcon, UserGroupIcon, UserIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { HERO_BACK, PageHero } from '@/components/common/page-blocks'
import { StateMessage } from '@/components/games/StateMessage'
import { InvitationsSection } from '@/components/invitations/InvitationsSection'
import { TeamMembersSection } from '@/components/teams/TeamMembersSection'
import { TeamOverview } from '@/components/teams/TeamOverview'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { readNotice } from '@/features/games/notice'
import { deleteTournamentTeam, getTournamentTeam, listTournamentTeamMembers } from '@/features/teams/api'
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
  const { userId, isAdmin } = useAuth()
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
      <div className="grid w-full max-w-6xl gap-6 self-start">
        <PageHero icon={UserGroupIcon} title={t('tournamentTeams.details')} />
        <StateMessage kind="error">{t('teams.errors.invalidId')}</StateMessage>
      </div>
    )
  }

  return (
    <div className="grid w-full max-w-6xl gap-6 self-start">
      {!team ? <PageHero icon={UserGroupIcon} title={t('tournamentTeams.details')} /> : null}

      {notice ? <StateMessage kind="success">{t(notice.key, notice.params)}</StateMessage> : null}

      {state.status === 'loading' ? (
        <StateMessage kind="loading">{t('tournamentTeams.loadingDetails')}</StateMessage>
      ) : null}

      {state.status === 'error' ? (
        <>
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
              { label: t('tournamentTeams.kind'), icon: UserGroupIcon, value: t('tournamentTeams.kindValue') },
              {
                label: t('tournamentTeams.tournament'),
                icon: ChampionIcon,
                value: (
                  <Link to={`/tournaments/${team.tournament_id}`} className="font-mono text-primary underline underline-offset-4">
                    {team.tournament_id}
                  </Link>
                ),
              },
              {
                label: t('teams.owner'),
                icon: UserIcon,
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
            back={
              <Link to={`/tournaments/${team.tournament_id}/teams`} className={HERO_BACK}>
                <Icon icon={ArrowLeft01Icon} size={16} />
                {t('tournamentTeams.returnToList')}
              </Link>
            }
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
          <TeamMembersSection
            scope="tournament"
            teamId={team.id}
            ownerId={team.owner_id}
            canManage={canManage}
            canAdd={isAdmin}
          />
          {canManage ? (
            <InvitationsSection
              type="tournament_team"
              resourceId={team.id}
              resourceName={team.name}
              hint={t('invitations.manage.teamHint')}
              loadExcluded={(signal) =>
                listTournamentTeamMembers(team.id, signal).then((members) => members.map((member) => member.user_id))
              }
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
