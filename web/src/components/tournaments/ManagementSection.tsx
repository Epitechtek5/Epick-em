import {
  Crown02Icon,
  Delete02Icon,
  Exchange01Icon,
  Mail01Icon,
  RefreshIcon,
  UserAdd01Icon,
  UserShield01Icon,
} from '@hugeicons/core-free-icons'
import { useState, type FormEvent } from 'react'

import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { StateMessage } from '@/components/games/StateMessage'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import {
  assignTournamentRole,
  inviteToTournament,
  listInvitations,
  listTournamentRoles,
  removeInvitation,
  revokeTournamentRole,
  transferTournamentOwnership,
} from '@/features/tournaments/api'
import { tournamentErrorKey } from '@/features/tournaments/errors'
import { formatDateTime } from '@/features/tournaments/format'
import { roleLabelKey } from '@/features/tournaments/labels'
import {
  TOURNAMENT_ROLES,
  type Tournament,
  type TournamentAccess,
  type TournamentRole,
} from '@/features/tournaments/types'
import { listAllUsers } from '@/features/users/api'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useUsernames } from '@/hooks/use-usernames'
import { useI18n, type MessageKey, type Params } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'
import { Avatar, SectionCard } from './ui'

interface Feedback {
  kind: 'success' | 'error'
  key: MessageKey
  params?: Params
}

interface ManagementSectionProps {
  tournament: Tournament
  access: TournamentAccess
  // Après un transfert : le tournoi et les droits sont relus.
  onOwnershipChanged: () => void
}

// Gestion du tournoi (organisateurs) : propriétaire et équipe d'organisation (GET /roles),
// désignation et retrait des administrateurs et arbitres, transfert de propriété confirmé
// (propriétaire), invitations d'un tournoi sur invitation. Le serveur reste juge de chaque action.
export function ManagementSection({ tournament, access, onOwnershipChanged }: ManagementSectionProps) {
  const { t, lang } = useI18n()
  const { userId, refreshRole } = useAuth()
  const owner = access.can_assign_roles
  const roles = useAsyncResource((signal) => listTournamentRoles(tournament.id, signal), [tournament.id])
  const invitationOnly = tournament.visibility === 'invitation_only'
  const invitations = useAsyncResource(
    (signal) => (invitationOnly ? listInvitations(tournament.id, signal) : Promise.resolve([])),
    [tournament.id, invitationOnly],
  )
  // Comptes proposés pour un rôle, une invitation ou un transfert.
  const users = useAsyncResource((signal) => listAllUsers(signal), [])
  const team = roles.state.status === 'success' ? roles.state.data : null
  const invited = invitations.state.status === 'success' ? invitations.state.data : []
  const ownerId = team?.owner_id ?? tournament.owner_id
  const names = useUsernames([
    ...(ownerId ? [ownerId] : []),
    ...(team?.roles.map((role) => role.user_id) ?? []),
    ...invited.map((invitation) => invitation.user_id),
  ])
  const nameOf = (id: string) => names[id] ?? t('teams.unknownUser')
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  async function mutate(target: string, run: () => Promise<unknown>, success: Feedback, after?: () => void) {
    setBusy(target)
    setFeedback(null)
    try {
      await run()
      setFeedback(success)
      after?.()
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      setFeedback({ kind: 'error', key: tournamentErrorKey(error) })
    } finally {
      setBusy(null)
      roles.reload()
      invitations.reload()
    }
  }

  const options = (users.state.status === 'success' ? users.state.data : []).map((user) => ({
    value: user.id,
    label: user.username,
  }))

  // Serveur sans gestion des rôles (404) ou compte qui n'organise plus le tournoi (403) : la
  // section n'a rien à montrer.
  if (roles.state.status === 'error' && roles.state.error instanceof ApiError && [403, 404].includes(roles.state.error.status)) {
    return null
  }

  return (
    <SectionCard
      id="management-title"
      icon={UserShield01Icon}
      title={t('tournaments.management.title')}
      subtitle={t(owner ? 'tournaments.management.ownerHint' : 'tournaments.management.adminHint')}
      actions={
        <Button variant="outline" size="sm" onClick={roles.reload} disabled={roles.state.status === 'loading'}>
          <Icon icon={RefreshIcon} />
          {t('tournaments.management.refresh')}
        </Button>
      }
    >
      {feedback ? <StateMessage kind={feedback.kind}>{t(feedback.key, feedback.params)}</StateMessage> : null}
      {roles.state.status === 'loading' ? (
        <StateMessage kind="loading">{t('tournaments.management.loading')}</StateMessage>
      ) : null}
      {roles.state.status === 'error' ? (
        <StateMessage kind="error">{t(tournamentErrorKey(roles.state.error))}</StateMessage>
      ) : null}

      {team ? (
        <ul aria-label={t('tournaments.management.list')} className="grid divide-y overflow-hidden rounded-xl ring-1 ring-foreground/10">
          <li className="flex flex-wrap items-center justify-between gap-3 bg-card px-4 py-3">
            <span className="flex items-center gap-3">
              <Avatar name={ownerId ? nameOf(ownerId) : '?'} />
              <span className="grid">
                <span className="font-semibold">
                  {ownerId ? nameOf(ownerId) : t('tournaments.management.noOwner')}
                  {ownerId && ownerId === userId ? (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">({t('teams.you')})</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Icon icon={Crown02Icon} size={14} />
                  {t(roleLabelKey('owner'))}
                </span>
              </span>
            </span>
          </li>
          {team.roles.map((assignment) => {
            const name = nameOf(assignment.user_id)
            return (
              <li key={assignment.user_id} className="flex flex-wrap items-center justify-between gap-3 bg-card px-4 py-3">
                <span className="flex items-center gap-3">
                  <Avatar name={name} />
                  <span className="grid">
                    <span className="font-semibold">
                      {name}
                      {assignment.user_id === userId ? (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">({t('teams.you')})</span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t(roleLabelKey(assignment.role))} ·{' '}
                      {t('tournaments.management.since', { date: formatDateTime(lang, assignment.granted_at) })}
                    </span>
                  </span>
                </span>
                {owner ? (
                  <ConfirmDialog
                    size="sm"
                    variant="destructive"
                    icon={Delete02Icon}
                    label={t('tournaments.management.revoke')}
                    busyLabel={t('tournaments.management.working')}
                    triggerAriaLabel={t('tournaments.management.revokeFor', { name })}
                    title={t('tournaments.management.confirmRevokeTitle')}
                    description={t('tournaments.management.confirmRevoke', {
                      name,
                      role: t(roleLabelKey(assignment.role)),
                    })}
                    busy={busy === assignment.user_id}
                    disabled={busy !== null}
                    onConfirm={() =>
                      void mutate(assignment.user_id, () => revokeTournamentRole(tournament.id, assignment.user_id), {
                        kind: 'success',
                        key: 'tournaments.management.revoked',
                        params: { name },
                      })
                    }
                  />
                ) : null}
              </li>
            )
          })}
          {team.roles.length === 0 ? (
            <li className="bg-card px-4 py-3 text-sm text-muted-foreground">{t('tournaments.management.noRoles')}</li>
          ) : null}
        </ul>
      ) : null}

      {owner && team ? (
        <AssignRoleForm
          options={options.filter((option) => option.value !== ownerId)}
          loading={users.state.status !== 'success'}
          busy={busy !== null}
          onAssign={(user, role, name) =>
            mutate('assign', () => assignTournamentRole(tournament.id, user, role), {
              kind: 'success',
              key: 'tournaments.management.assigned',
              params: { name, role: t(roleLabelKey(role)) },
            })
          }
        />
      ) : null}

      {owner && team ? (
        <TransferOwnership
          tournament={tournament}
          options={options.filter((option) => option.value !== ownerId)}
          loading={users.state.status !== 'success'}
          busy={busy !== null}
          onTransfer={(user, name) =>
            mutate(
              'transfer',
              () => transferTournamentOwnership(tournament.id, user),
              { kind: 'success', key: 'tournaments.management.transferred', params: { name } },
              onOwnershipChanged,
            )
          }
        />
      ) : null}

      {invitationOnly ? (
        <section aria-labelledby="invitations-title" className="grid gap-3 rounded-xl p-4 ring-1 ring-foreground/10 ring-inset">
          <h3 id="invitations-title" className="flex items-center gap-2 text-base font-semibold">
            <Icon icon={Mail01Icon} size={18} />
            {t('tournaments.management.invitations')}
          </h3>
          <p className="text-sm text-muted-foreground">{t('tournaments.management.invitationsHint')}</p>
          {invited.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('tournaments.management.noInvitations')}</p>
          ) : (
            <ul aria-label={t('tournaments.management.invitationList')} className="grid divide-y">
              {invited.map((invitation) => {
                const name = nameOf(invitation.user_id)
                return (
                  <li key={invitation.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="font-medium">{name}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      aria-label={t('tournaments.management.uninviteFor', { name })}
                      onClick={() =>
                        void mutate(invitation.user_id, () => removeInvitation(tournament.id, invitation.user_id), {
                          kind: 'success',
                          key: 'tournaments.management.uninvited',
                          params: { name },
                        })
                      }
                    >
                      <Icon icon={Delete02Icon} />
                      {t('tournaments.management.uninvite')}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          <InviteForm
            options={options.filter((option) => !invited.some((invitation) => invitation.user_id === option.value))}
            loading={users.state.status !== 'success'}
            busy={busy !== null}
            onInvite={(user, name) =>
              mutate('invite', () => inviteToTournament(tournament.id, user), {
                kind: 'success',
                key: 'tournaments.management.invited',
                params: { name },
              })
            }
          />
        </section>
      ) : null}
    </SectionCard>
  )
}

interface Option {
  value: string
  label: string
}

function AssignRoleForm({
  options,
  loading,
  busy,
  onAssign,
}: {
  options: Option[]
  loading: boolean
  busy: boolean
  onAssign: (user: string, role: TournamentRole, name: string) => void
}) {
  const { t } = useI18n()
  const [user, setUser] = useState('')
  const [role, setRole] = useState<TournamentRole>('admin')
  function submit(event: FormEvent) {
    event.preventDefault()
    const chosen = options.find((option) => option.value === user)
    if (!chosen || busy) return
    onAssign(chosen.value, role, chosen.label)
    setUser('')
  }
  return (
    <form
      aria-labelledby="assign-role-title"
      onSubmit={submit}
      className="grid gap-3 rounded-xl bg-muted/40 p-4"
    >
      <h3 id="assign-role-title" className="text-base font-semibold">
        {t('tournaments.management.assignTitle')}
      </h3>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-56 gap-1">
          <Label htmlFor="assign-role-user">{t('tournaments.management.account')}</Label>
          <SearchableSelect
            id="assign-role-user"
            options={options}
            value={user}
            onChange={setUser}
            placeholder={t('tournaments.management.chooseAccount')}
            noResultsLabel={t('common.noResults')}
            disabled={loading}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="assign-role-role">{t('tournaments.management.roleLabel')}</Label>
          <NativeSelect id="assign-role-role" value={role} onChange={(event) => setRole(event.target.value as TournamentRole)}>
            {TOURNAMENT_ROLES.map((value) => (
              <option key={value} value={value}>
                {t(roleLabelKey(value))}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" disabled={busy || !user}>
          <Icon icon={UserAdd01Icon} />
          {t('tournaments.management.assign')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t('tournaments.management.rolesHint')}</p>
    </form>
  )
}

function InviteForm({
  options,
  loading,
  busy,
  onInvite,
}: {
  options: Option[]
  loading: boolean
  busy: boolean
  onInvite: (user: string, name: string) => void
}) {
  const { t } = useI18n()
  const [user, setUser] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault()
    const chosen = options.find((option) => option.value === user)
    if (!chosen || busy) return
    onInvite(chosen.value, chosen.label)
    setUser('')
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="grid min-w-56 gap-1">
        <Label htmlFor="invite-user">{t('tournaments.management.inviteAccount')}</Label>
        <SearchableSelect
          id="invite-user"
          options={options}
          value={user}
          onChange={setUser}
          placeholder={t('tournaments.management.chooseAccount')}
          noResultsLabel={t('common.noResults')}
          disabled={loading}
        />
      </div>
      <Button type="submit" variant="outline" disabled={busy || !user}>
        <Icon icon={Mail01Icon} />
        {t('tournaments.management.invite')}
      </Button>
    </form>
  )
}

// Transfert de propriété : confirmation explicite en retapant le nom du tournoi.
function TransferOwnership({
  tournament,
  options,
  loading,
  busy,
  onTransfer,
}: {
  tournament: Tournament
  options: Option[]
  loading: boolean
  busy: boolean
  onTransfer: (user: string, name: string) => void
}) {
  const { t } = useI18n()
  const [user, setUser] = useState('')
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const chosen = options.find((option) => option.value === user)
  const confirmed = typed.trim() === tournament.name

  return (
    <div className="grid gap-3 rounded-xl p-4 ring-1 ring-amber-500/40 ring-inset">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <Icon icon={Exchange01Icon} size={18} />
        {t('tournaments.management.transferTitle')}
      </h3>
      <p className="text-sm text-muted-foreground">{t('tournaments.management.transferHint')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-56 gap-1">
          <Label htmlFor="transfer-user">{t('tournaments.management.newOwner')}</Label>
          <SearchableSelect
            id="transfer-user"
            options={options}
            value={user}
            onChange={setUser}
            placeholder={t('tournaments.management.chooseAccount')}
            noResultsLabel={t('common.noResults')}
            disabled={loading}
          />
        </div>
        <AlertDialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (!next) setTyped('')
          }}
        >
          <Button variant="destructive" disabled={busy || !chosen} onClick={() => setOpen(true)}>
            <Icon icon={Exchange01Icon} />
            {t('tournaments.management.transfer')}
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('tournaments.management.confirmTransferTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('tournaments.management.confirmTransfer', { name: chosen?.label ?? '', tournament: tournament.name })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-1">
              <Label htmlFor="transfer-confirm">{t('tournaments.management.typeName', { tournament: tournament.name })}</Label>
              <Input
                id="transfer-confirm"
                value={typed}
                autoComplete="off"
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={!confirmed || busy}
                onClick={() => {
                  if (!chosen) return
                  setOpen(false)
                  setTyped('')
                  onTransfer(chosen.value, chosen.label)
                  setUser('')
                }}
              >
                {t('tournaments.management.confirmTransferButton')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
