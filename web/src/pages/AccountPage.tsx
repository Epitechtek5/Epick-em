import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { ErrorSummary } from '@/components/form/ErrorSummary'
import { TextField } from '@/components/form/TextField'
import { useFormErrors } from '@/components/form/use-form-errors'
import { StateMessage } from '@/components/games/StateMessage'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card'
import { getMe, updateEmail, type SelfProfile } from '@/features/account/api'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n } from '@/i18n/context'
import { ApiError, NetworkError } from '@/lib/api/client'
import { getErrorCode, getFieldErrors } from '@/lib/api/errors'
import { normalizeEmail, serverFieldErrors, validateEmail } from '@/lib/validation/auth'

type Load =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; profile: SelfProfile }

const FIELD_IDS = { email: 'account-email' }
const sectionTitle = 'font-heading text-base leading-snug font-medium'

// Compte connecté : affiche ses propres informations (GET /me) et permet de changer
// l'adresse e-mail (PATCH /me/update). Seul le compte connecté voit son adresse.
// Un 401 est géré par le client API (renouvellement, sinon retour à la connexion).
export default function AccountPage() {
  const { t } = useI18n()
  useDocumentTitle(t('account.title'))
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getMe(controller.signal)
      .then((profile) => setLoad({ status: 'ready', profile }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoad({ status: 'error' })
      })
    return () => controller.abort()
  }, [attempt])

  const retry = useCallback(() => {
    setLoad({ status: 'loading' })
    setAttempt((current) => current + 1)
  }, [])

  return (
    <div className="grid w-full max-w-2xl gap-6 self-start">
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('account.title')}</h1>
        <p className="text-muted-foreground">{t('account.description')}</p>
      </div>
      {load.status === 'loading' ? (
        <StateMessage kind="loading">{t('account.loading')}</StateMessage>
      ) : load.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={retry}>
              {t('common.retry')}
            </Button>
          }
        >
          {t('account.loadError')}
        </StateMessage>
      ) : (
        <>
          <ProfileCard profile={load.profile} />
          <EmailForm
            profile={load.profile}
            onUpdated={(profile) => setLoad({ status: 'ready', profile })}
          />
        </>
      )}
    </div>
  )
}

function ProfileCard({ profile }: { profile: SelfProfile }) {
  const { t } = useI18n()
  return (
    <Card>
      <CardHeader>
        <h2 className={sectionTitle}>{t('account.profile')}</h2>
        <CardDescription>{t('account.privacy')}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
          <dt className="text-muted-foreground">{t('account.username')}</dt>
          <dd className="font-medium break-all">{profile.username}</dd>
          <dt className="text-muted-foreground">{t('account.email')}</dt>
          <dd className="grid gap-1">
            {profile.email ? (
              <>
                <span className="font-medium break-all">{profile.email}</span>
                <span className="text-muted-foreground">
                  {t(profile.email_verified_at ? 'account.verified' : 'account.unverified')}
                </span>
              </>
            ) : (
              <span>{t('account.noEmail')}</span>
            )}
            {profile.pending_email ? (
              <span className="break-all">
                {t('account.pending', { email: profile.pending_email })}
              </span>
            ) : null}
          </dd>
        </dl>
      </CardContent>
    </Card>
  )
}

function EmailForm({
  profile,
  onUpdated,
}: {
  profile: SelfProfile
  onUpdated: (profile: SelfProfile) => void
}) {
  const { t } = useI18n()
  const form = useFormErrors<'email'>()
  const { summaryRef } = form
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSentTo(null)
    const emailError = validateEmail(email)
    if (emailError) {
      form.fail({ email: emailError })
      return
    }
    if (profile.email && normalizeEmail(email) === profile.email && !profile.pending_email) {
      form.fail({ email: 'account.sameEmail' })
      return
    }

    setSubmitting(true)
    form.clear()
    try {
      const updated = await updateEmail(email)
      onUpdated(updated)
      setSentTo(email.trim())
      setEmail('')
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && getErrorCode(error.body) === 'email_taken') {
        form.fail({ email: 'auth.validation.emailTaken' })
      } else if (error instanceof ApiError && error.status === 400) {
        const fieldErrors = serverFieldErrors(
          getFieldErrors(error.body, ['email']),
          () => validateEmail(email),
          ['email'],
        )
        form.fail(fieldErrors, Object.keys(fieldErrors).length > 0 ? null : 'auth.errors.rejected')
      } else if (error instanceof NetworkError) {
        form.fail({}, 'auth.errors.network')
      } else {
        form.fail({}, 'auth.errors.unexpected')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className={sectionTitle}>{t('account.changeTitle')}</h2>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate aria-busy={submitting} aria-label={t('account.changeTitle')}>
        <CardContent className="grid gap-5">
          <div aria-live="polite">
            {sentTo ? (
              <p className="rounded-lg border border-primary p-4 text-sm">
                {t('account.updated', { email: sentTo })}
              </p>
            ) : null}
          </div>
          <ErrorSummary ref={summaryRef} items={form.summaryItems(FIELD_IDS, t)} />
          <TextField
            id={FIELD_IDS.email}
            label={t('account.newEmail')}
            hint={t('account.changeHint')}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              form.clearField('email')
            }}
            error={form.errors.email ? t(form.errors.email) : undefined}
          />
        </CardContent>
        <CardFooter className="mt-6">
          <Button type="submit" disabled={submitting}>
            {submitting ? t('account.submitting') : t('account.submit')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
