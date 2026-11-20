import {
  Alert02Icon,
  Copy01Icon,
  Link01Icon,
  Mail01Icon,
  RefreshIcon,
  Share08Icon,
  UserAdd01Icon,
} from '@hugeicons/core-free-icons'
import { useId, useState, type FormEvent } from 'react'

import { EmptyState, SectionCard } from '@/components/common/page-blocks'
import { StateMessage } from '@/components/games/StateMessage'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { createInvitation, listSentForResource } from '@/features/invitations/api'
import { invitationErrorKey } from '@/features/invitations/errors'
import { effectiveStatus, VALIDITY_CHOICES } from '@/features/invitations/labels'
import type { CreatedInvitation, InvitationType } from '@/features/invitations/types'
import { teamRoleLabelKey } from '@/features/teams/labels'
import { ASSIGNABLE_ROLES, type AssignableTeamRole } from '@/features/teams/types'
import { formatDateTime } from '@/features/tournaments/format'
import { listAllUsers } from '@/features/users/api'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useUsernames } from '@/hooks/use-usernames'
import { useI18n, type MessageKey } from '@/i18n/context'
import { useAuth } from '@/lib/auth/auth-context'
import { InvitationCard, type InvitationFeedback } from './InvitationCard'

type Mode = 'user' | 'link'

const VALIDITY_LABELS: Record<number, MessageKey> = {
  0: 'invitations.manage.validityDefault',
  24: 'invitations.manage.validity24',
  72: 'invitations.manage.validity72',
  168: 'invitations.manage.validity168',
}

interface InvitationsSectionProps {
  type: InvitationType
  resourceId: string
  resourceName: string
  // Comptes déjà membres ou inscrits : ils ne sont pas proposés.
  loadExcluded?: (signal: AbortSignal) => Promise<string[]>
  // Consigne propre à la ressource (ex. règles d'inscription d'un tournoi).
  hint?: string
}

// Invitations d'une ressource, pour qui peut inviter (propriétaire d'une équipe, administrateur
// pour un tournoi) : inviter un compte existant ou générer un lien partageable, puis suivre,
// relancer ou révoquer les invitations envoyées. Le jeton d'un lien n'est montré qu'une fois.
export function InvitationsSection({ type, resourceId, resourceName, loadExcluded, hint }: InvitationsSectionProps) {
  const { t } = useI18n()
  const { userId } = useAuth()
  const sent = useAsyncResource((signal) => listSentForResource(type, resourceId, signal), [type, resourceId])
  const [feedback, setFeedback] = useState<InvitationFeedback | null>(null)
  const [created, setCreated] = useState<CreatedInvitation | null>(null)
  // Une erreur de lecture des membres n'empêche pas d'inviter : le serveur refusera un doublon.
  const excluded = useAsyncResource(
    (signal) => (loadExcluded ? loadExcluded(signal).catch(() => []) : Promise.resolve([])),
    [type, resourceId],
  )
  const excludedIds = excluded.state.status === 'success' ? excluded.state.data : []

  const invitations = sent.state.status === 'success' ? sent.state.data : []
  const pending = invitations.filter((invitation) => effectiveStatus(invitation) === 'pending')
  const history = invitations.filter((invitation) => effectiveStatus(invitation) !== 'pending')
  const names = useUsernames(invitations.flatMap((invitation) => (invitation.recipient_id ? [invitation.recipient_id] : [])))
  const pendingIds = pending.flatMap((invitation) => (invitation.recipient_id ? [invitation.recipient_id] : []))
  const titleId = `${type}-invitations-title`

  return (
    <SectionCard
      id={titleId}
      icon={Mail01Icon}
      title={t('invitations.manage.title')}
      subtitle={hint ?? t('invitations.manage.subtitle')}
      actions={
        <Button variant="outline" size="sm" onClick={sent.reload} disabled={sent.state.status === 'loading'}>
          <Icon icon={RefreshIcon} />
          {t('invitations.refresh')}
        </Button>
      }
    >
      <CreateInvitationForm
        type={type}
        resourceId={resourceId}
        excludedIds={[...excludedIds, ...pendingIds, ...(userId ? [userId] : [])]}
        onCreated={(invitation) => {
          setFeedback(null)
          setCreated(invitation.link ? invitation : null)
          if (!invitation.link) {
            setFeedback({
              kind: 'success',
              key: 'invitations.messages.sent',
              params: { name: resourceName },
            })
          }
          sent.reload()
          excluded.reload()
        }}
      />

      {created?.link ? <CreatedLink invitation={created} onDismiss={() => setCreated(null)} /> : null}

      {feedback ? <StateMessage kind={feedback.kind}>{t(feedback.key, feedback.params)}</StateMessage> : null}

      <h3 className="text-base font-semibold">{t('invitations.manage.pending')}</h3>
      {sent.state.status === 'loading' ? (
        <StateMessage kind="loading">{t('invitations.loading')}</StateMessage>
      ) : null}
      {sent.state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={sent.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(invitationErrorKey(sent.state.error))}
        </StateMessage>
      ) : null}
      {sent.state.status === 'success' && pending.length === 0 ? (
        <EmptyState icon={Mail01Icon}>{t('invitations.manage.empty')}</EmptyState>
      ) : null}
      {pending.length > 0 ? (
        <ul aria-label={t('invitations.manage.pending')} className="grid gap-3">
          {pending.map((invitation) => (
            <li key={invitation.id}>
              <InvitationCard
                invitation={invitation}
                resourceName={resourceName}
                names={names}
                hideResource
                onFeedback={setFeedback}
                onChanged={sent.reload}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {history.length > 0 ? (
        <details className="grid gap-3">
          <summary className="cursor-pointer text-sm font-semibold">
            {t('invitations.manage.history', { count: history.length })}
          </summary>
          <ul aria-label={t('invitations.manage.historyList')} className="mt-3 grid gap-3">
            {history.map((invitation) => (
              <li key={invitation.id}>
                <InvitationCard
                  invitation={invitation}
                  resourceName={resourceName}
                  names={names}
                  hideResource
                  onFeedback={setFeedback}
                  onChanged={sent.reload}
                />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </SectionCard>
  )
}

function CreateInvitationForm({
  type,
  resourceId,
  excludedIds,
  onCreated,
}: {
  type: InvitationType
  resourceId: string
  excludedIds: readonly string[]
  onCreated: (invitation: CreatedInvitation) => void
}) {
  const { t } = useI18n()
  const prefix = useId()
  const users = useAsyncResource((signal) => listAllUsers(signal), [])
  const [mode, setMode] = useState<Mode>('user')
  const [recipient, setRecipient] = useState('')
  const [role, setRole] = useState<AssignableTeamRole>('member')
  const [validity, setValidity] = useState('')
  const [maxUses, setMaxUses] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ReturnType<typeof invitationErrorKey> | null>(null)
  const withRole = type !== 'tournament'

  const options = (users.state.status === 'success' ? users.state.data : [])
    .filter((user) => !excludedIds.includes(user.id))
    .map((user) => ({ value: user.id, label: user.username }))
  const uses = Number(maxUses)
  const usesValid = Number.isInteger(uses) && uses >= 1 && uses <= 1000
  const ready = mode === 'user' ? recipient !== '' : usesValid

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      const invitation = await createInvitation({
        type,
        resource_id: resourceId,
        ...(mode === 'user' ? { recipient_id: recipient } : { max_uses: uses }),
        ...(withRole ? { role } : {}),
        ...(validity ? { expires_in_hours: Number(validity) } : {}),
      })
      setRecipient('')
      onCreated(invitation)
    } catch (caught) {
      setError(invitationErrorKey(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      aria-label={t('invitations.manage.form')}
      className="grid gap-4 rounded-xl bg-muted/40 p-4 ring-1 ring-foreground/10"
      onSubmit={(event) => void submit(event)}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t('invitations.manage.mode')}</legend>
        <div className="flex flex-wrap gap-4">
          {(['user', 'link'] as const).map((value) => (
            <label key={value} className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${prefix}-mode`}
                value={value}
                checked={mode === value}
                onChange={() => {
                  setMode(value)
                  setError(null)
                }}
                className="size-4 accent-primary"
              />
              {t(value === 'user' ? 'invitations.manage.modeUser' : 'invitations.manage.modeLink')}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-3">
        {mode === 'user' ? (
          <div className="grid min-w-56 flex-1 gap-1">
            <Label htmlFor={`${prefix}-recipient`}>{t('invitations.manage.recipient')}</Label>
            <SearchableSelect
              id={`${prefix}-recipient`}
              options={options}
              value={recipient}
              onChange={setRecipient}
              placeholder={
                users.state.status === 'loading' ? t('invitations.manage.loadingUsers') : t('invitations.manage.chooseUser')
              }
              noResultsLabel={t('common.noResults')}
              disabled={users.state.status !== 'success'}
            />
          </div>
        ) : (
          <div className="grid w-40 gap-1">
            <Label htmlFor={`${prefix}-uses`}>{t('invitations.manage.maxUses')}</Label>
            <Input
              id={`${prefix}-uses`}
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              value={maxUses}
              aria-invalid={!usesValid || undefined}
              aria-describedby={!usesValid ? `${prefix}-uses-error` : undefined}
              onChange={(event) => setMaxUses(event.target.value)}
            />
          </div>
        )}
        {withRole ? (
          <div className="grid gap-1">
            <Label htmlFor={`${prefix}-role`}>{t('invitations.manage.role')}</Label>
            <NativeSelect
              id={`${prefix}-role`}
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
        ) : null}
        <div className="grid gap-1">
          <Label htmlFor={`${prefix}-validity`}>{t('invitations.manage.validity')}</Label>
          <NativeSelect id={`${prefix}-validity`} value={validity} onChange={(event) => setValidity(event.target.value)}>
            {VALIDITY_CHOICES.map((hours) => (
              <option key={hours ?? 'default'} value={hours ?? ''}>
                {t(VALIDITY_LABELS[hours ?? 0])}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" disabled={!ready || busy}>
          <Icon icon={mode === 'user' ? UserAdd01Icon : Link01Icon} />
          {busy
            ? t('invitations.manage.creating')
            : t(mode === 'user' ? 'invitations.manage.send' : 'invitations.manage.generate')}
        </Button>
      </div>
      {mode === 'link' && !usesValid ? (
        <p id={`${prefix}-uses-error`} className="text-sm text-destructive">
          {t('invitations.errors.maxUses')}
        </p>
      ) : null}
      {users.state.status === 'error' && mode === 'user' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={users.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t('invitations.manage.usersUnavailable')}
        </StateMessage>
      ) : null}
      {error ? <StateMessage kind="error">{t(error)}</StateMessage> : null}
    </form>
  )
}

// Lien tout juste créé : seule occasion de le copier ou de le partager.
function CreatedLink({ invitation, onDismiss }: { invitation: CreatedInvitation; onDismiss: () => void }) {
  const { t, lang } = useI18n()
  const prefix = useId()
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle')
  const link = invitation.link ?? ''
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopy('done')
    } catch {
      setCopy('failed')
    }
  }

  return (
    <section
      aria-labelledby={`${prefix}-title`}
      className="grid gap-3 rounded-xl border border-primary p-4"
    >
      <h3 id={`${prefix}-title`} className="font-semibold">
        {t('invitations.manage.linkReady')}
      </h3>
      <p className="flex items-start gap-2 text-sm">
        <Icon icon={Alert02Icon} size={16} className="mt-0.5 shrink-0" />
        {t('invitations.manage.linkOnce')}
      </p>
      <div className="grid gap-1">
        <Label htmlFor={`${prefix}-link`}>{t('invitations.manage.link')}</Label>
        <Input
          id={`${prefix}-link`}
          readOnly
          value={link}
          className="font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {t('invitations.expires', { date: formatDateTime(lang, invitation.expires_at) })}
        {invitation.max_uses !== null
          ? ` · ${t('invitations.uses', { used: invitation.uses, max: invitation.max_uses })}`
          : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void copyLink()}>
          <Icon icon={Copy01Icon} />
          {t('invitations.manage.copy')}
        </Button>
        {canShare ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void navigator.share({ title: t('invitations.manage.shareTitle'), url: link }).catch(() => {})}
          >
            <Icon icon={Share08Icon} />
            {t('invitations.manage.share')}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onDismiss}>
          {t('invitations.manage.done')}
        </Button>
      </div>
      {copy !== 'idle' ? (
        <p role="status" className={copy === 'failed' ? 'text-sm text-destructive' : 'text-sm'}>
          {t(copy === 'done' ? 'invitations.manage.copied' : 'invitations.manage.copyFailed')}
        </p>
      ) : null}
    </section>
  )
}
