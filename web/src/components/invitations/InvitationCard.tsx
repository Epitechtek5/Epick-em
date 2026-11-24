import {
  Cancel01Icon,
  ChampionIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Link01Icon,
  MailReply01Icon,
  UnavailableIcon,
  UserGroupIcon,
  UserIcon,
  ViewIcon,
} from '@hugeicons/core-free-icons'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import { Chip } from '@/components/common/page-blocks'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { actOnInvitation, invitationResourcePath } from '@/features/invitations/api'
import { invitationErrorKey } from '@/features/invitations/errors'
import { effectiveStatus, invitationTypeLabelKey, isExhausted } from '@/features/invitations/labels'
import type { Invitation, InvitationAction } from '@/features/invitations/types'
import { teamRoleLabelKey } from '@/features/teams/labels'
import { formatDateTime } from '@/features/tournaments/format'
import { useI18n, type MessageKey, type Params } from '@/i18n/context'
import { useAuth } from '@/lib/auth/auth-context'
import { InvitationStatusBadge } from './InvitationStatusBadge'

export interface InvitationFeedback {
  kind: 'success' | 'error'
  key: MessageKey
  params?: Params
}

const TYPE_ICONS = { team: UserGroupIcon, tournament_team: UserGroupIcon, tournament: ChampionIcon } as const

const SUCCESS: Record<InvitationAction, MessageKey> = {
  accept: 'invitations.messages.accepted',
  decline: 'invitations.messages.declined',
  revoke: 'invitations.messages.revoked',
  resend: 'invitations.messages.resent',
}

interface InvitationCardProps {
  invitation: Invitation
  // Nom de la ressource : undefined pendant le chargement, null si elle n'est plus visible.
  resourceName: string | null | undefined
  names: Record<string, string>
  // Masque la ressource (déjà connue, ex. sur la fiche d'une équipe).
  hideResource?: boolean
  // Lien vers la page de l'invitation (absent sur cette page elle-même).
  showDetails?: boolean
  onFeedback: (feedback: InvitationFeedback) => void
  // Après une action, réussie ou non : la liste est relue.
  onChanged: () => void
}

// Une invitation : ressource, interlocuteur, rôle, échéance et usages, avec les actions permises
// au compte connecté (l'invité accepte ou refuse, l'invitant relance ou révoque). Le serveur
// reste juge de chaque action.
export function InvitationCard({
  invitation,
  resourceName,
  names,
  hideResource,
  showDetails = true,
  onFeedback,
  onChanged,
}: InvitationCardProps) {
  const { t, lang } = useI18n()
  const { userId } = useAuth()
  const [busy, setBusy] = useState<InvitationAction | null>(null)
  const status = effectiveStatus(invitation)
  const pending = status === 'pending'
  const exhausted = pending && isExhausted(invitation)
  const sent = invitation.inviter_id === userId
  const received = invitation.recipient_id !== null && invitation.recipient_id === userId
  const resourceLabel =
    resourceName === undefined ? '…' : (resourceName ?? t('invitations.resourceUnavailable'))
  const nameOf = (id: string) => names[id] ?? t('teams.unknownUser')
  const title = resourceName ?? t(invitationTypeLabelKey(invitation.type))

  async function run(action: InvitationAction) {
    setBusy(action)
    try {
      await actOnInvitation(invitation.id, action)
      onFeedback({ kind: 'success', key: SUCCESS[action], params: { name: title } })
    } catch (error) {
      onFeedback({ kind: 'error', key: invitationErrorKey(error) })
    } finally {
      setBusy(null)
      onChanged()
    }
  }

  // Interlocuteur : sur la fiche d'une ressource, il est déjà dans le titre de la carte.
  const facts: Array<{ icon: typeof UserIcon; text: ReactNode }> = []
  if (!hideResource && invitation.is_link) facts.push({ icon: Link01Icon, text: t('invitations.sharedLink') })
  else if (!hideResource && sent) {
    facts.push({ icon: UserIcon, text: t('invitations.to', { name: nameOf(invitation.recipient_id ?? '') }) })
  }
  if (!sent) facts.push({ icon: UserIcon, text: t('invitations.from', { name: nameOf(invitation.inviter_id) }) })
  if (invitation.role) {
    facts.push({ icon: UserGroupIcon, text: t('invitations.roleValue', { role: t(teamRoleLabelKey(invitation.role)) }) })
  }
  facts.push({
    icon: Clock01Icon,
    text: t(pending ? 'invitations.expires' : 'invitations.expired', { date: formatDateTime(lang, invitation.expires_at) }),
  })
  if (invitation.is_link) {
    facts.push({
      icon: Link01Icon,
      text:
        invitation.max_uses === null
          ? t('invitations.usesUnlimited', { used: invitation.uses })
          : t('invitations.uses', { used: invitation.uses, max: invitation.max_uses }),
    })
  }

  return (
    <article
      aria-label={t('invitations.cardLabel', { name: title })}
      className="grid gap-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary dark:bg-primary/25 dark:text-violet-200">
            <Icon icon={TYPE_ICONS[invitation.type]} size={20} />
          </span>
          <div className="grid min-w-0 gap-1">
            {hideResource ? (
              <h3 className="font-semibold">
                {invitation.is_link
                  ? t('invitations.sharedLink')
                  : t('invitations.to', { name: nameOf(invitation.recipient_id ?? '') })}
              </h3>
            ) : (
              <h3 className="font-semibold break-words">
                {resourceName ? (
                  <Link
                    to={invitationResourcePath(invitation.type, invitation.resource_id)}
                    className="underline-offset-4 hover:underline"
                  >
                    {resourceLabel}
                  </Link>
                ) : (
                  resourceLabel
                )}
              </h3>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <InvitationStatusBadge status={status} />
              <Chip>{t(invitationTypeLabelKey(invitation.type))}</Chip>
              {exhausted ? <Chip>{t('invitations.exhausted')}</Chip> : null}
            </div>
          </div>
        </div>
        {showDetails ? (
        <Link
          to={`/invitations/${invitation.id}`}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          aria-label={t('invitations.viewFor', { name: title })}
        >
          <Icon icon={ViewIcon} />
          {t('invitations.view')}
        </Link>
        ) : null}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {facts.map((fact, index) => (
          <li key={index} className="inline-flex items-center gap-1.5">
            <Icon icon={fact.icon} size={14} />
            {fact.text}
          </li>
        ))}
      </ul>

      {pending && (received || sent) ? (
        <div className="flex flex-wrap gap-2">
          {received ? (
            <>
              <Button size="sm" disabled={busy !== null} onClick={() => void run('accept')}>
                <Icon icon={CheckmarkCircle02Icon} />
                {busy === 'accept' ? t('invitations.accepting') : t('invitations.accept')}
              </Button>
              <ConfirmDialog
                size="sm"
                icon={Cancel01Icon}
                label={t('invitations.decline')}
                busyLabel={t('invitations.declining')}
                triggerAriaLabel={t('invitations.declineFor', { name: title })}
                title={t('invitations.confirmDeclineTitle')}
                description={t('invitations.confirmDecline', { name: title })}
                busy={busy === 'decline'}
                disabled={busy !== null}
                onConfirm={() => void run('decline')}
              />
            </>
          ) : null}
          {sent && !invitation.is_link ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              aria-label={t('invitations.resendFor', { name: title })}
              onClick={() => void run('resend')}
            >
              <Icon icon={MailReply01Icon} />
              {busy === 'resend' ? t('invitations.resending') : t('invitations.resend')}
            </Button>
          ) : null}
          {sent ? (
            <ConfirmDialog
              size="sm"
              variant="destructive"
              icon={UnavailableIcon}
              label={t('invitations.revoke')}
              busyLabel={t('invitations.revoking')}
              triggerAriaLabel={t('invitations.revokeFor', { name: title })}
              title={t('invitations.confirmRevokeTitle')}
              description={t('invitations.confirmRevoke')}
              busy={busy === 'revoke'}
              disabled={busy !== null}
              onConfirm={() => void run('revoke')}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
