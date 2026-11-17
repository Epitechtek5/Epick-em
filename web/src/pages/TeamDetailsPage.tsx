import { ArrowLeft01Icon, GameController01Icon, UserGroupIcon, UserIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { HERO_BACK, PageHero } from '@/components/common/page-blocks'
import { StateMessage } from '@/components/games/StateMessage'
import { TeamMembersSection } from '@/components/teams/TeamMembersSection'
import { TeamOverview } from '@/components/teams/TeamOverview'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { getGame } from '@/features/games/api'
import { readNotice } from '@/features/games/notice'
import { deleteTeam, getTeam } from '@/features/teams/api'
import { teamErrorKey } from '@/features/teams/errors'
import { isUuid, ownsTeam } from '@/features/teams/validation'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useUsernames } from '@/hooks/use-usernames'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

// Fiche d'une équipe globale (GET /teams/{id}) et de ses membres.
export default function TeamDetailsPage() {
  const { id = '' } = useParams()
  const { t } = useI18n()
  const { userId } = useAuth()
  const navigate = useNavigate()
  const notice = readNotice(useLocation().state)
  const valid = isUuid(id)

  const { state, reload } = useAsyncResource(
    (signal) => (valid ? getTeam(id, signal) : Promise.reject(new ApiError(404, undefined))),
    [id],
  )
  const team = state.status === 'success' ? state.data : null
  useDocumentTitle(team?.name ?? t('teams.details'))

  const gameState = useAsyncResource(
    (signal) => (team ? getGame(team.game_id, signal) : Promise.resolve(null)),
    [team?.game_id],
  )
  const owners = useUsernames(team ? [team.owner_id] : [])
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<MessageKey | null>(null)
  const canManage = ownsTeam(team?.owner_id, userId)

  async function remove() {
    if (!team) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteTeam(team.id)
      navigate('/teams', { replace: true, state: { notice: { key: 'teams.deleted', params: { name: team.name } } } })
    } catch (error) {
      setDeleteError(teamErrorKey(error))
      setDeleting(false)
    }
  }

  const back = (
    <Link to="/teams" className={HERO_BACK}>
      <Icon icon={ArrowLeft01Icon} size={16} />
      {t('teams.returnToList')}
    </Link>
  )

  if (!valid) {
    return (
      <div className="grid w-full max-w-6xl gap-6 self-start">
        <PageHero icon={UserGroupIcon} title={t('teams.details')} back={back} />
        <StateMessage kind="error">
          {t('teams.errors.invalidId')}
        </StateMessage>
      </div>
    )
  }

  const gameName =
    gameState.state.status === 'success' && gameState.state.data
      ? gameState.state.data.name
      : gameState.state.status === 'error'
        ? t('teams.unknownGame')
        : '…'

  return (
    <div className="grid w-full max-w-6xl gap-6 self-start">
      {!team ? <PageHero icon={UserGroupIcon} title={t('teams.details')} back={back} /> : null}

      {notice ? <StateMessage kind="success">{t(notice.key, notice.params)}</StateMessage> : null}

      {state.status === 'loading' ? <StateMessage kind="loading">{t('teams.loadingDetails')}</StateMessage> : null}

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
              {
                label: t('teams.game'),
                icon: GameController01Icon,
                value: <Link to={`/games/${team.game_id}`} className="text-primary underline underline-offset-4">{gameName}</Link>,
              },
              {
                label: t('teams.owner'),
                icon: UserIcon,
                value: `${owners[team.owner_id] ?? t('teams.unknownUser')}${canManage ? ` (${t('teams.you')})` : ''}`,
              },
              { label: t('teams.identifier'), value: <span className="font-mono">{team.id}</span> },
            ]}
            back={back}
            canManage={canManage}
            editTo={`/teams/${team.id}/edit`}
            deleteLabels={{
              label: t('teams.delete'),
              busy: t('teams.deleting'),
              title: t('teams.confirmDeleteTitle'),
              description: t('teams.confirmDelete', { name: team.name }),
            }}
            deleting={deleting}
            deleteError={deleteError}
            onDelete={remove}
            onRefresh={reload}
          />
          {!canManage ? <p className="text-sm text-muted-foreground">{t('teams.readOnly')}</p> : null}
          <TeamMembersSection scope="team" teamId={team.id} ownerId={team.owner_id} canManage={canManage} />
        </>
      ) : null}
    </div>
  )
}
