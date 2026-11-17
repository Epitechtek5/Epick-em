import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useNoReferrer } from '@/hooks/use-no-referrer'
import { useI18n } from '@/i18n/context'
import { apiRequest, ApiError } from '@/lib/api/client'
import { useAuth } from '@/lib/auth/auth-context'

interface Invitation {
  type: 'team' | 'tournament_team' | 'tournament'
  resource_id?: string
  resource_name?: string
  inviter_username?: string
  recipient_id?: string | null
  status?: string
  expires_at: string
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function InvitationPage() {
  useNoReferrer()
  const { token, id } = useParams()
  const { isAuthenticated, userId } = useAuth()
  const { t } = useI18n()
  const location = useLocation()
  const valid = token ? /^[a-zA-Z0-9_-]{32,256}$/.test(token) : uuid.test(id ?? '')
  if (!valid) return <p role="alert">{t('invitation.unavailable')}</p>
  if (!isAuthenticated)
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{t('invitation.title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p>{t('invitation.login')}</p>
          <Button asChild>
            <Link to="/login" state={{ from: location.pathname }}>
              {t('auth.login.title')}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/register" state={{ from: location.pathname }}>
              {t('auth.register.title')}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <a href={`epickem://${token ? `invite/${token}` : `invitations/${id}`}`}>
              {t('invitation.openApp')}
            </a>
          </Button>
        </CardContent>
      </Card>
    )
  return <Details key={`${userId}:${location.pathname}`} token={token} id={id} />
}

function Details({ token, id }: { token?: string; id?: string }) {
  const { t } = useI18n()
  const { userId } = useAuth()
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [error, setError] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<'accepted' | 'declined' | null>(null)
  const [revision, setRevision] = useState(0)
  const active = useRef(false)
  const lock = useRef(false)
  const path = token ? `/invitation-links/${token}` : `/invitations/${id}`
  useEffect(() => {
    active.current = true
    let cancelled = false
    void apiRequest<Invitation>(path)
      .then(async (value) => {
        if (cancelled) return
        if (!value.resource_name && value.resource_id) {
          const collection =
            value.type === 'team'
              ? 'teams'
              : value.type === 'tournament_team'
                ? 'tournament-teams'
                : 'tournaments'
          const resource = await apiRequest<{ name: string }>(
            `/${collection}/${value.resource_id}`,
          ).catch(() => null)
          if (cancelled) return
          value.resource_name = resource?.name
        }
        setInvitation(value)
        setError(false)
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        setError(true)
        setUnavailable(caught instanceof ApiError && [403, 404, 409, 410].includes(caught.status))
      })
    return () => {
      cancelled = true
      active.current = false
    }
  }, [path, revision])

  async function respond(action: 'accept' | 'decline') {
    if (!active.current || lock.current) return
    lock.current = true
    setBusy(true)
    setError(false)
    try {
      const response = await apiRequest<Invitation>(`${path}/${action}`, { method: 'POST' })
      if (!active.current) return
      setInvitation((current) => (current ? { ...current, ...response } : response))
      setResult(action === 'accept' ? 'accepted' : 'declined')
    } catch (caught) {
      if (active.current) {
        setError(true)
        setUnavailable(caught instanceof ApiError && [403, 404, 409, 410].includes(caught.status))
      }
    } finally {
      if (active.current) {
        lock.current = false
        setBusy(false)
      }
    }
  }
  const pending =
    !result && !unavailable && (!invitation?.status || invitation.status === 'pending')
  const resource = invitation?.resource_id
    ? `/${invitation.type === 'team' ? 'teams' : invitation.type === 'tournament_team' ? 'tournament-teams' : 'tournaments'}/${invitation.resource_id}`
    : null
  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t('invitation.title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4" aria-busy={busy}>
        {!invitation && !error ? <p role="status">{t('common.loading')}</p> : null}
        {error ? (
          <div role="alert">
            <p>{t(unavailable ? 'invitation.unavailable' : 'invitation.error')}</p>
            {!unavailable ? (
              <Button variant="outline" onClick={() => setRevision(revision + 1)}>
                {t('common.retry')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {invitation ? (
          <>
            <h2 className="text-xl font-semibold">
              {invitation.resource_name ?? t('invitation.title')}
            </h2>
            {invitation.inviter_username ? <p>{invitation.inviter_username}</p> : null}
            <p className="text-sm text-muted-foreground">
              {t('invitation.expires')} {new Date(invitation.expires_at).toLocaleString()}
            </p>
            {result ? (
              <p role="status">
                {t(result === 'accepted' ? 'invitation.accepted' : 'invitation.declined')}
              </p>
            ) : null}
            {!pending && !result ? <p>{t('invitation.unavailable')}</p> : null}
            {pending && (token || invitation.recipient_id === userId) ? (
              <>
                <Button disabled={busy} onClick={() => void respond('accept')}>
                  {t('invitation.accept')}
                </Button>
                {!token ? (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(t('invitation.confirmDecline'))) void respond('decline')
                    }}
                  >
                    {t('invitation.decline')}
                  </Button>
                ) : null}
              </>
            ) : null}
            {result === 'accepted' && resource ? (
              <Button asChild>
                <Link to={resource}>{t('invitation.openResource')}</Link>
              </Button>
            ) : null}
          </>
        ) : null}
        <Button asChild variant="outline">
          <a href={`epickem://${token ? `invite/${token}` : `invitations/${id}`}`}>
            {t('invitation.openApp')}
          </a>
        </Button>
      </CardContent>
    </Card>
  )
}
