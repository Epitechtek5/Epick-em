import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Mail01Icon,
  MailReceive01Icon,
  MailSend01Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { useSearchParams } from 'react-router'

import { EmptyState, HERO_ACTION, PageHero } from '@/components/common/page-blocks'
import { StateMessage } from '@/components/games/StateMessage'
import { InvitationCard, type InvitationFeedback } from '@/components/invitations/InvitationCard'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { INVITATIONS_PAGE_SIZE, listInvitations } from '@/features/invitations/api'
import { invitationErrorKey } from '@/features/invitations/errors'
import { invitationStatusLabelKey, invitationTypeLabelKey } from '@/features/invitations/labels'
import {
  INVITATION_STATUSES,
  INVITATION_TYPES,
  type InvitationDirection,
  type InvitationStatus,
  type InvitationType,
} from '@/features/invitations/types'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { resourceKey, useInvitationResources } from '@/hooks/use-invitation-resources'
import { useUsernames } from '@/hooks/use-usernames'
import { useI18n } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { cn } from '@/lib/utils'

function readPage(raw: string | null): number {
  const page = Number.parseInt(raw ?? '1', 10)
  return Number.isFinite(page) && page >= 1 ? page : 1
}

const pick = <T extends string>(values: readonly T[], raw: string | null): T | '' =>
  values.includes(raw as T) ? (raw as T) : ''

const TABS: Array<{ value: InvitationDirection; icon: typeof Mail01Icon }> = [
  { value: 'incoming', icon: MailReceive01Icon },
  { value: 'outgoing', icon: MailSend01Icon },
]

// Boîte des invitations : reçues ou envoyées (GET /invitations?direction=), filtrées par statut
// et par type, paginées par le serveur (`total`). Onglet, filtres et page vivent dans l'URL.
export default function InvitationsPage() {
  const { t } = useI18n()
  useDocumentTitle(t('invitations.title'))
  const [params, setParams] = useSearchParams()
  const direction: InvitationDirection = params.get('direction') === 'outgoing' ? 'outgoing' : 'incoming'
  const status = pick<InvitationStatus>(INVITATION_STATUSES, params.get('status'))
  const type = pick<InvitationType>(INVITATION_TYPES, params.get('type'))
  const page = readPage(params.get('page'))
  const [feedback, setFeedback] = useState<InvitationFeedback | null>(null)

  const { state, reload } = useAsyncResource(
    (signal) =>
      listInvitations(
        {
          direction,
          status: status || undefined,
          type: type || undefined,
          limit: INVITATIONS_PAGE_SIZE,
          offset: (page - 1) * INVITATIONS_PAGE_SIZE,
        },
        signal,
      ),
    [direction, status, type, page],
  )
  const items = state.status === 'success' ? state.data.items : []
  const total = state.status === 'success' ? state.data.total : 0
  const pages = Math.max(1, Math.ceil(total / INVITATIONS_PAGE_SIZE))
  const names = useUsernames(
    items.flatMap((invitation) => [invitation.inviter_id, ...(invitation.recipient_id ? [invitation.recipient_id] : [])]),
  )
  const resources = useInvitationResources(items)

  const update = (next: { direction?: InvitationDirection; status?: string; type?: string; page?: number }) => {
    const query: Record<string, string> = {}
    const nextDirection = next.direction ?? direction
    const nextStatus = next.status ?? (next.direction ? '' : status)
    const nextType = next.type ?? (next.direction ? '' : type)
    if (nextDirection === 'outgoing') query.direction = 'outgoing'
    if (nextStatus) query.status = nextStatus
    if (nextType) query.type = nextType
    if ((next.page ?? 1) > 1) query.page = String(next.page)
    setFeedback(null)
    setParams(query)
  }

  const filtered = Boolean(status || type)

  return (
    <div className="grid w-full max-w-6xl gap-6 self-start">
      <PageHero icon={Mail01Icon} title={t('invitations.title')} description={t('invitations.description')}>
        <Button variant="outline" className={HERO_ACTION} onClick={reload} disabled={state.status === 'loading'}>
          <Icon icon={RefreshIcon} />
          {t('invitations.refresh')}
        </Button>
      </PageHero>

      <div className="grid gap-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/10 sm:p-6">
        <nav aria-label={t('invitations.directions')}>
          <ul className="flex flex-wrap gap-2">
            {TABS.map((tab) => {
              const active = tab.value === direction
              return (
                <li key={tab.value}>
                  <Button
                    variant={active ? 'default' : 'outline'}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => update({ direction: tab.value })}
                  >
                    <Icon icon={tab.icon} />
                    {t(tab.value === 'incoming' ? 'invitations.incoming' : 'invitations.outgoing')}
                  </Button>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl" role="search">
          <div className="grid gap-1">
            <Label htmlFor="invitations-status">{t('invitations.status')}</Label>
            <NativeSelect
              id="invitations-status"
              value={status}
              onChange={(event) => update({ status: event.target.value })}
            >
              <option value="">{t('invitations.allStatuses')}</option>
              {INVITATION_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(invitationStatusLabelKey(value))}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="invitations-type">{t('invitations.type')}</Label>
            <NativeSelect id="invitations-type" value={type} onChange={(event) => update({ type: event.target.value })}>
              <option value="">{t('invitations.allTypes')}</option>
              {INVITATION_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(invitationTypeLabelKey(value))}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      </div>

      {feedback ? <StateMessage kind={feedback.kind}>{t(feedback.key, feedback.params)}</StateMessage> : null}

      {state.status === 'loading' ? <StateMessage kind="loading">{t('invitations.loading')}</StateMessage> : null}

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
          {t(invitationErrorKey(state.error))}
        </StateMessage>
      ) : null}

      {state.status === 'success' && items.length === 0 ? (
        <EmptyState icon={direction === 'incoming' ? MailReceive01Icon : MailSend01Icon}>
          {filtered
            ? t('invitations.emptyFiltered')
            : t(direction === 'incoming' ? 'invitations.emptyIncoming' : 'invitations.emptyOutgoing')}
        </EmptyState>
      ) : null}

      {items.length > 0 ? (
        <ul
          aria-label={t(direction === 'incoming' ? 'invitations.incomingList' : 'invitations.outgoingList')}
          className="grid gap-3"
        >
          {items.map((invitation) => (
            <li key={invitation.id}>
              <InvitationCard
                invitation={invitation}
                resourceName={resources[resourceKey(invitation.type, invitation.resource_id)]}
                names={names}
                onFeedback={setFeedback}
                onChanged={reload}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {state.status === 'success' && total > INVITATIONS_PAGE_SIZE ? (
        <nav aria-label={t('invitations.pagination')} className="flex items-center justify-between gap-3">
          <Button variant="outline" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>
            <Icon icon={ArrowLeft01Icon} />
            {t('games.previous')}
          </Button>
          <span className={cn('text-sm text-muted-foreground')} aria-current="page">
            {t('invitations.page', { page, pages })}
          </span>
          <Button variant="outline" disabled={page >= pages} onClick={() => update({ page: page + 1 })}>
            {t('games.next')}
            <Icon icon={ArrowRight01Icon} />
          </Button>
        </nav>
      ) : null}
    </div>
  )
}
