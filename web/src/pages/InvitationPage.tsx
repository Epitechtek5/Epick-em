import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Login03Icon,
  Mail01Icon,
  SmartPhone01Icon,
  UserAdd01Icon,
  UserGroupIcon,
  UserIcon,
  ViewIcon,
} from '@hugeicons/core-free-icons'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'

import { FactTile, HERO_BACK, PageHero, SectionCard } from '@/components/common/page-blocks'
import { StateMessage } from '@/components/games/StateMessage'
import { InvitationCard, type InvitationFeedback } from '@/components/invitations/InvitationCard'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import {
  acceptInvitationLink,
  getInvitation,
  invitationResourceName,
  invitationResourcePath,
  isInvitationToken,
  previewInvitationLink,
} from '@/features/invitations/api'
import { invitationErrorKey, isInvitationGone } from '@/features/invitations/errors'
import { effectiveStatus, invitationTypeLabelKey } from '@/features/invitations/labels'
import type { AcceptedLink, Invitation, InvitationLinkPreview } from '@/features/invitations/types'
import { isUuid } from '@/features/teams/validation'
import { teamRoleLabelKey } from '@/features/teams/labels'
import { formatDateTime } from '@/features/tournaments/format'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useNoReferrer } from '@/hooks/use-no-referrer'
import { useUsernames } from '@/hooks/use-usernames'
import { useI18n } from '@/i18n/context'
import { useAuth } from '@/lib/auth/auth-context'

// Lien reçu (`/invite/{jeton}`) ou invitation à un compte (`/invitations/{id}`). Sans session,
// rien n'est demandé au serveur : la connexion ou l'inscription ramène ici (état `from`). Le
// jeton n'est jamais transmis à un site tiers (pas de référent).
export default function InvitationPage() {
  useNoReferrer()
  const { token, id } = useParams()
  const { isAuthenticated, userId } = useAuth()
  const { t } = useI18n()
  const location = useLocation()
  useDocumentTitle(t('invitation.title'))
  const valid = token !== undefined ? isInvitationToken(token) : isUuid(id ?? '')
  const appLink = `epickem://${token ? `invite/${token}` : `invitations/${id}`}`

  const back = isAuthenticated ? (
    <Link to="/invitations" className={HERO_BACK}>
      <Icon icon={ArrowLeft01Icon} size={16} />
      {t('invitation.back')}
    </Link>
  ) : undefined

  if (!valid) {
    return (
      <div className="grid w-full max-w-3xl gap-6 self-start">
        <PageHero icon={Mail01Icon} title={t('invitation.title')} back={back} />
        <StateMessage kind="error">{t('invitation.unavailable')}</StateMessage>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="grid w-full max-w-3xl gap-6 self-start">
        <PageHero icon={Mail01Icon} title={t('invitation.title')} description={t('invitation.login')} />
        <SectionCard id="invitation-signin" icon={Login03Icon} title={t('invitation.signInTitle')}>
          <div className="flex flex-wrap gap-2">
            <Link to="/login" state={{ from: location.pathname }} className={buttonVariants()}>
              <Icon icon={Login03Icon} />
              {t('auth.login.title')}
            </Link>
            <Link to="/register" state={{ from: location.pathname }} className={buttonVariants({ variant: 'outline' })}>
              <Icon icon={UserAdd01Icon} />
              {t('auth.register.title')}
            </Link>
            <a href={appLink} className={buttonVariants({ variant: 'outline' })}>
              <Icon icon={SmartPhone01Icon} />
              {t('invitation.openApp')}
            </a>
          </div>
        </SectionCard>
      </div>
    )
  }

  // Changement de compte ou de lien : tout l'état est repris de zéro.
  return token ? (
    <LinkInvitation key={`${userId}:${token}`} token={token} back={back} appLink={appLink} />
  ) : (
    <AccountInvitation key={`${userId}:${id}`} id={id ?? ''} back={back} appLink={appLink} />
  )
}

function OpenApp({ href }: { href: string }) {
  const { t } = useI18n()
  return (
    <a href={href} className={buttonVariants({ variant: 'outline' })}>
      <Icon icon={SmartPhone01Icon} />
      {t('invitation.openApp')}
    </a>
  )
}

// Lien partageable : aperçu sans donnée privée, puis acceptation (un lien ne se refuse pas).
function LinkInvitation({ token, back, appLink }: { token: string; back?: React.ReactNode; appLink: string }) {
  const { t, lang } = useI18n()
  const { state, reload } = useAsyncResource((signal) => previewInvitationLink(token, signal), [token])
  const [accepted, setAccepted] = useState<AcceptedLink | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const lock = useRef(false)
  const preview: InvitationLinkPreview | null = state.status === 'success' ? state.data : null
  const loadError = state.status === 'error' ? state.error : null
  const failure = error ?? loadError
  const gone = failure !== null && isInvitationGone(failure)

  async function accept() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      setAccepted(await acceptInvitationLink(token))
    } catch (caught) {
      setError(caught)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return (
    <div className="grid w-full max-w-3xl gap-6 self-start">
      <PageHero
        icon={Mail01Icon}
        title={preview?.resource_name ?? t('invitation.title')}
        description={preview ? t('invitation.invitedBy', { name: preview.inviter_username }) : undefined}
        back={back}
      />

      {state.status === 'loading' ? <StateMessage kind="loading">{t('common.loading')}</StateMessage> : null}

      {failure !== null ? (
        <StateMessage
          kind="error"
          action={
            gone ? undefined : (
              <Button variant="outline" size="sm" onClick={error ? () => void accept() : reload}>
                {t('common.retry')}
              </Button>
            )
          }
        >
          {gone && loadError ? t('invitation.unavailable') : t(error ? invitationErrorKey(error) : 'invitation.error')}
        </StateMessage>
      ) : null}

      {preview ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-3">
            <FactTile icon={UserGroupIcon} label={t('invitations.type')}>
              {t(invitationTypeLabelKey(preview.type))}
            </FactTile>
            {preview.role ? (
              <FactTile icon={UserIcon} label={t('invitations.manage.role')}>
                {t(teamRoleLabelKey(preview.role))}
              </FactTile>
            ) : null}
            <FactTile icon={Clock01Icon} label={t('invitation.expires')}>
              {formatDateTime(lang, preview.expires_at)}
            </FactTile>
          </dl>
          <SectionCard
            id="invitation-answer"
            icon={accepted ? CheckmarkCircle02Icon : Mail01Icon}
            title={t(accepted ? 'invitation.acceptedTitle' : 'invitation.answer')}
            subtitle={preview.type === 'tournament' ? t('invitations.manage.tournamentHint') : undefined}
          >
            {accepted ? <StateMessage kind="success">{t('invitation.accepted')}</StateMessage> : null}
            <div className="flex flex-wrap gap-2">
              {accepted ? (
                <Link to={invitationResourcePath(accepted.type, accepted.resource_id)} className={buttonVariants()}>
                  <Icon icon={ViewIcon} />
                  {t('invitation.openResource')}
                </Link>
              ) : gone ? null : (
                <Button disabled={busy} onClick={() => void accept()}>
                  <Icon icon={CheckmarkCircle02Icon} />
                  {busy ? t('invitations.accepting') : t('invitation.accept')}
                </Button>
              )}
              <OpenApp href={appLink} />
            </div>
          </SectionCard>
        </>
      ) : (
        <div>
          <OpenApp href={appLink} />
        </div>
      )}
    </div>
  )
}

// Invitation à un compte : l'invité répond, l'invitant relance ou révoque.
function AccountInvitation({ id, back, appLink }: { id: string; back?: React.ReactNode; appLink: string }) {
  const { t } = useI18n()
  const { userId } = useAuth()
  const { state, reload } = useAsyncResource((signal) => getInvitation(id, signal), [id])
  const invitation: Invitation | null = state.status === 'success' ? state.data : null
  const [resourceName, setResourceName] = useState<string | null | undefined>(undefined)
  const [feedback, setFeedback] = useState<InvitationFeedback | null>(null)
  const names = useUsernames(
    invitation ? [invitation.inviter_id, ...(invitation.recipient_id ? [invitation.recipient_id] : [])] : [],
  )

  useEffect(() => {
    if (!invitation) return
    const controller = new AbortController()
    void invitationResourceName(invitation.type, invitation.resource_id, controller.signal).then((name) => {
      if (!controller.signal.aborted) setResourceName(name)
    })
    return () => controller.abort()
  }, [invitation?.type, invitation?.resource_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const joined =
    invitation !== null && invitation.status === 'accepted' && invitation.recipient_id === userId
  const gone = state.status === 'error' && isInvitationGone(state.error)

  return (
    <div className="grid w-full max-w-3xl gap-6 self-start">
      <PageHero
        icon={Mail01Icon}
        title={resourceName ?? t('invitation.title')}
        description={
          invitation && invitation.inviter_id !== userId
            ? t('invitation.invitedBy', { name: names[invitation.inviter_id] ?? '…' })
            : undefined
        }
        back={back}
      />

      {state.status === 'loading' ? <StateMessage kind="loading">{t('common.loading')}</StateMessage> : null}

      {state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            gone ? undefined : (
              <Button variant="outline" size="sm" onClick={reload}>
                {t('common.retry')}
              </Button>
            )
          }
        >
          {t(gone ? 'invitation.unavailable' : 'invitation.error')}
        </StateMessage>
      ) : null}

      {feedback ? <StateMessage kind={feedback.kind}>{t(feedback.key, feedback.params)}</StateMessage> : null}

      {invitation ? (
        <>
          <InvitationCard
            invitation={invitation}
            resourceName={resourceName}
            names={names}
            showDetails={false}
            onFeedback={setFeedback}
            onChanged={reload}
          />
          {effectiveStatus(invitation) === 'pending' && invitation.type === 'tournament' ? (
            <p className="text-sm text-muted-foreground">{t('invitations.manage.tournamentHint')}</p>
          ) : null}
        </>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {joined ? (
          <Link to={invitationResourcePath(invitation.type, invitation.resource_id)} className={buttonVariants()}>
            <Icon icon={ViewIcon} />
            {t('invitation.openResource')}
          </Link>
        ) : null}
        <OpenApp href={appLink} />
      </div>
    </div>
  )
}
