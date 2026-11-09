import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router'

import { ResendVerification } from '@/components/auth/ResendVerification'
import { ErrorSummary } from '@/components/form/ErrorSummary'
import { TextField } from '@/components/form/TextField'
import { useFormErrors } from '@/components/form/use-form-errors'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError, NetworkError } from '@/lib/api/client'
import { getErrorCode, getFieldErrors } from '@/lib/api/errors'
import { useAuth } from '@/lib/auth/auth-context'
import {
  AUTH_LIMITS,
  serverFieldErrors,
  validateLogin,
  type LoginField,
} from '@/lib/validation/auth'

const FIELD_IDS: Record<LoginField, string> = {
  email: 'login-email',
  password: 'login-password',
}
const FIELDS = Object.keys(FIELD_IDS) as LoginField[]

// Messages transmis par les pages qui renvoient vers la connexion.
export interface LoginLocationState {
  registered?: boolean
  email?: string
  passwordReset?: boolean
}

const linkClass = 'text-primary underline underline-offset-2'

export default function LoginPage() {
  const { t } = useI18n()
  useDocumentTitle(t('auth.login.title'))
  const { login } = useAuth()
  const location = useLocation()
  const state = (location.state ?? {}) as LoginLocationState
  const form = useFormErrors<LoginField>()
  const { summaryRef } = form

  const [values, setValues] = useState({ email: state.email ?? '', password: '' })
  const [submitting, setSubmitting] = useState(false)
  // Adresse refusée parce que non confirmée : propose de renvoyer le lien.
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)

  const onChange = (field: LoginField) => (event: ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }))
    form.clearField(field)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const validationErrors = validateLogin(values)
    if (Object.keys(validationErrors).length > 0) {
      form.fail(validationErrors)
      return
    }

    setSubmitting(true)
    setUnverifiedEmail(null)
    form.clear()
    try {
      // Succès : GuestRoute redirige vers la page visée (ou l'accueil).
      await login(values)
    } catch (error) {
      if (error instanceof ApiError && error.status === 403 && getErrorCode(error.body) === 'email_unverified') {
        setUnverifiedEmail(values.email)
        form.fail({})
      } else if (error instanceof ApiError && error.status === 401) {
        form.fail({}, 'auth.login.invalidCredentials')
      } else if (error instanceof ApiError && error.status === 400) {
        const fieldErrors = serverFieldErrors(
          getFieldErrors(error.body, FIELDS),
          (field) => validateLogin(values)[field] ?? null,
          FIELDS,
        )
        form.fail(
          fieldErrors,
          Object.keys(fieldErrors).length > 0 ? null : 'auth.errors.rejected',
        )
      } else if (error instanceof NetworkError) {
        form.fail({}, 'auth.errors.network')
      } else {
        form.fail({}, 'auth.errors.unexpected')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const tl = (key: MessageKey) => t(key, AUTH_LIMITS)

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t('auth.login.title')}</CardTitle>
        <CardDescription>{t('auth.login.description')}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate aria-busy={submitting}>
        <CardContent className="grid gap-5">
          {state.registered ? (
            <div role="status" className="grid gap-3 rounded-lg border border-primary p-4 text-sm">
              <p>
                <span className="font-semibold">{t('auth.login.registeredTitle')}</span>{' '}
                {t('auth.login.registered', { email: state.email ?? '' })}
              </p>
              {state.email ? <ResendVerification email={state.email} /> : null}
            </div>
          ) : null}
          {state.passwordReset ? (
            <p role="status" className="rounded-lg border border-primary p-4 text-sm">
              {t('auth.login.passwordReset')}
            </p>
          ) : null}
          {unverifiedEmail ? (
            <div
              ref={summaryRef}
              role="alert"
              tabIndex={-1}
              className="grid gap-3 rounded-lg border border-destructive p-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <p>
                <span className="font-semibold text-destructive">
                  {t('auth.login.unverifiedTitle')}
                </span>{' '}
                {t('auth.login.unverified')}
              </p>
              <ResendVerification email={unverifiedEmail} />
            </div>
          ) : (
            <ErrorSummary ref={summaryRef} items={form.summaryItems(FIELD_IDS, tl)} />
          )}
          <TextField
            id={FIELD_IDS.email}
            label={t('auth.fields.email')}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={values.email}
            onChange={onChange('email')}
            error={form.errors.email ? tl(form.errors.email) : undefined}
          />
          <div className="grid gap-2">
            <TextField
              id={FIELD_IDS.password}
              label={t('auth.fields.password')}
              type="password"
              autoComplete="current-password"
              value={values.password}
              onChange={onChange('password')}
              error={form.errors.password ? tl(form.errors.password) : undefined}
            />
            <Link to="/forgot-password" className={`justify-self-start text-sm ${linkClass}`}>
              {t('auth.login.forgot')}
            </Link>
          </div>
        </CardContent>
        <CardFooter className="mt-6 flex-col items-stretch gap-4">
          <Button type="submit" disabled={submitting}>
            {submitting ? t('auth.login.submitting') : t('auth.login.submit')}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t('auth.login.noAccount')}{' '}
            <Link to="/register" className={linkClass}>
              {t('auth.login.createAccount')}
            </Link>
          </p>
          <p className="text-center text-sm text-muted-foreground">
            {t('auth.login.legacy')}{' '}
            <Link to="/enroll-email" className={linkClass}>
              {t('auth.login.legacyLink')}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
