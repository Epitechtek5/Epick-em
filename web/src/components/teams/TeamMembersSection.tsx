import { UserAdd01Icon, UserSwitchIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'

import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { StateMessage } from '@/components/games/StateMessage'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import {
  addTeamMember,
  addTournamentTeamMember,
  listTeamMembers,
  listTournamentTeamMembers,
  removeTeamMember,
  removeTournamentTeamMember,
  updateTeamMember,
  updateTournamentTeamMember,
} from '@/features/teams/api'
import { teamErrorKey } from '@/features/teams/errors'
import { teamRoleLabelKey } from '@/features/teams/labels'
import { ASSIGNABLE_ROLES, type AssignableTeamRole, type TeamRole } from '@/features/teams/types'
import { isUuid } from '@/features/teams/validation'
import { listAllUsers } from '@/features/users/api'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useUsernames } from '@/hooks/use-usernames'
import { useI18n, type MessageKey, type Params } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'

export type TeamScope = 'team' | 'tournament'

// Membre commun aux deux portées ; seules les équipes globales gardent l'historique.
interface Member {
  user_id: string
  role: TeamRole
  joined_at?: string
  left_at?: string | null
}

const API = {
  team: {
    list: listTeamMembers,
    add: addTeamMember,
    update: updateTeamMember,
    remove: removeTeamMember,
  },
  tournament: {
    list: listTournamentTeamMembers,
    add: addTournamentTeamMember,
    update: updateTournamentTeamMember,
    remove: removeTournamentTeamMember,
  },
} as const

interface Feedback {
  kind: 'success' | 'error'
  key: MessageKey
  params?: Params
}

interface TeamMembersSectionProps {
  scope: TeamScope
  teamId: string
  ownerId: string
  // Propriétaire connecté : seuls ses contrôles de gestion sont affichés.
  canManage: boolean
}

// Membres d'une équipe (globale ou de tournoi). Lecture pour tous ; le propriétaire ajoute un
// compte existant (membre ou remplaçant), change un rôle ou retire un membre. Le propriétaire
// n'est jamais modifiable et le rôle `owner` n'est jamais proposé. La liste est relue après
// chaque opération.
export function TeamMembersSection({ scope, teamId, ownerId, canManage }: TeamMembersSectionProps) {
  const { t, lang } = useI18n()
  const api = API[scope]
  const { state, reload } = useAsyncResource(
    (signal) => api.list(teamId, signal) as Promise<Member[]>,
    [scope, teamId],
  )
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const members = state.status === 'success' ? state.data : []
  const active = members.filter((member) => !member.left_at)
  const former = members.filter((member) => member.left_at)
  const names = useUsernames(members.map((member) => member.user_id))
  const nameOf = (userId: string) => names[userId] ?? t('teams.unknownUser')

  const date = (value?: string | null) => {
    if (!value) return ''
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime())
      ? value
      : new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(parsed)
  }

  async function mutate(target: string, run: () => Promise<unknown>, success: Feedback) {
    setBusy(target)
    setFeedback(null)
    try {
      await run()
      setFeedback(success)
    } catch (error) {
      setFeedback({ kind: 'error', key: teamErrorKey(error) })
    } finally {
      setBusy(null)
      // Succès comme échec (membre déjà retiré, 404…) : la liste affichée est relue.
      reload()
    }
  }

  const titleId = `${scope}-members-title`

  return (
    <section aria-labelledby={titleId} className="grid gap-3">
      <h2 id={titleId} className="text-lg font-semibold">
        {t('teams.members.title')}
      </h2>

      {feedback ? (
        <StateMessage kind={feedback.kind}>{t(feedback.key, feedback.params)}</StateMessage>
      ) : null}

      {state.status === 'loading' ? (
        <StateMessage kind="loading">{t('teams.members.loading')}</StateMessage>
      ) : null}

      {state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            state.error instanceof ApiError && state.error.status === 401 ? undefined : (
              <Button variant="outline" size="sm" onClick={reload}>
                {t('common.retry')}
              </Button>
            )
          }
        >
          {t(teamErrorKey(state.error))}
        </StateMessage>
      ) : null}

      {state.status === 'success' && active.length === 0 ? (
        <StateMessage kind="empty">{t('teams.members.empty')}</StateMessage>
      ) : null}

      {active.length > 0 ? (
        <ul aria-label={t('teams.members.active')} className="grid gap-2">
          {active.map((member) => {
            const name = nameOf(member.user_id)
            const isOwner = member.role === 'owner' || member.user_id === ownerId
            const nextRole: AssignableTeamRole = member.role === 'member' ? 'substitute' : 'member'
            return (
              <li
                key={member.user_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 ring-1 ring-foreground/10"
              >
                <div className="grid">
                  <span className="font-medium">{name}</span>
                  <span className="text-sm text-muted-foreground">
                    {t('teams.members.role')} : {t(teamRoleLabelKey(member.role))}
                    {member.joined_at ? ` · ${t('teams.members.joined', { date: date(member.joined_at) })}` : ''}
                  </span>
                </div>
                {canManage && !isOwner ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      aria-label={t('teams.members.setRoleFor', { name, role: t(teamRoleLabelKey(nextRole)) })}
                      onClick={() =>
                        mutate(member.user_id, () => api.update(teamId, member.user_id, nextRole), {
                          kind: 'success',
                          key: 'teams.members.roleChanged',
                          params: { name, role: t(teamRoleLabelKey(nextRole)) },
                        })
                      }
                    >
                      <Icon icon={UserSwitchIcon} />
                      {t('teams.members.setRole', { role: t(teamRoleLabelKey(nextRole)) })}
                    </Button>
                    <ConfirmDeleteDialog
                      size="sm"
                      label={t('teams.members.remove')}
                      busyLabel={t('teams.members.removing')}
                      triggerAriaLabel={t('teams.members.removeAction', { name })}
                      title={t('teams.members.confirmRemoveTitle')}
                      description={t('teams.members.confirmRemove', { name })}
                      busy={busy === member.user_id}
                      onConfirm={() =>
                        mutate(member.user_id, () => api.remove(teamId, member.user_id), {
                          kind: 'success',
                          key: 'teams.members.removed',
                          params: { name },
                        })
                      }
                    />
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      {former.length > 0 ? (
        <>
          <h3 className="text-base font-semibold">{t('teams.members.former')}</h3>
          <ul aria-label={t('teams.members.former')} className="grid gap-2">
            {former.map((member) => (
              <li
                key={`${member.user_id}-${member.left_at}`}
                className="grid rounded-lg px-3 py-2 text-sm ring-1 ring-foreground/10"
              >
                <span className="font-medium">{nameOf(member.user_id)}</span>
                <span className="text-muted-foreground">
                  {t(teamRoleLabelKey(member.role))} ·{' '}
                  {t('teams.members.period', { from: date(member.joined_at), to: date(member.left_at) })}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {canManage && state.status === 'success' ? (
        <AddMemberForm
          scope={scope}
          activeIds={active.map((member) => member.user_id)}
          busy={busy !== null}
          onAdd={(userId, username, role) =>
            mutate('add', () => api.add(teamId, userId, role), {
              kind: 'success',
              key: 'teams.members.added',
              params: { name: username, role: t(teamRoleLabelKey(role)) },
            })
          }
        />
      ) : null}
    </section>
  )
}

// Ajout d'un compte existant (GET /users), hors membres actifs, comme membre ou remplaçant.
function AddMemberForm({
  scope,
  activeIds,
  busy,
  onAdd,
}: {
  scope: TeamScope
  activeIds: string[]
  busy: boolean
  onAdd: (userId: string, username: string, role: AssignableTeamRole) => void
}) {
  const { t } = useI18n()
  const { state, reload } = useAsyncResource((signal) => listAllUsers(signal), [])
  const [selected, setSelected] = useState('')
  const [role, setRole] = useState<AssignableTeamRole>('member')

  if (state.status === 'loading') {
    return <StateMessage kind="loading">{t('teams.members.loadingUsers')}</StateMessage>
  }
  if (state.status === 'error') {
    return (
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
    )
  }

  const available = state.data.filter((user) => !activeIds.includes(user.id))
  const choice = available.find((user) => user.id === selected)

  if (available.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('teams.members.noneAvailable')}</p>
  }

  const userField = `${scope}-member-user`
  const roleField = `${scope}-member-role`

  return (
    <form
      aria-label={t('teams.members.add')}
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        // Identifiant invalide : aucune requête.
        if (!choice || !isUuid(choice.id)) return
        onAdd(choice.id, choice.username, role)
        setSelected('')
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor={userField}>{t('teams.members.user')}</Label>
        <NativeSelect
          id={userField}
          value={selected}
          className="min-w-56"
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">{t('teams.members.chooseUser')}</option>
          {available.map((user) => (
            <option key={user.id} value={user.id}>
              {user.username}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={roleField}>{t('teams.members.role')}</Label>
        <NativeSelect
          id={roleField}
          value={role}
          onChange={(event) => setRole(event.target.value as AssignableTeamRole)}
        >
          {ASSIGNABLE_ROLES.map((value) => (
            <option key={value} value={value}>
              {t(teamRoleLabelKey(value))}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" disabled={!choice || busy}>
        <Icon icon={UserAdd01Icon} />
        {busy ? t('teams.members.adding') : t('teams.members.addButton')}
      </Button>
    </form>
  )
}
