import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

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
import { useNoReferrer } from '@/hooks/use-no-referrer'
import { useI18n, type MessageKey } from '@/i18n/context'
import { resetPassword } from '@/lib/api/auth'
import { ApiError, NetworkError } from '@/lib/api/client'
import { getErrorCode, getFieldErrors } from '@/lib/api/errors'
import { useAuth } from '@/lib/auth/auth-context'
import { readResetToken } from '@/lib/auth/reset-token'
import {
  AUTH_LIMITS,
  serverFieldErrors,
  validateReset,
  type ResetField,
} from '@/lib/validation/auth'
import type { LoginLocationState } from './LoginPage'

const FIELD_IDS: Record<ResetField, string> = {
  password: 'reset-password',
  confirmPassword: 'reset-confirm-password',
}
const FIELDS = Object.keys(FIELD_IDS) as ResetField[]
const linkClass = 'text-center text-sm text-primary underline underline-offset-2'

// Lien reçu par e-mail : <PUBLIC_URL>/reset-password?token=…
// Le jeton est lu une seule fois, retiré aussitôt de la barre d'adresse (remplacement de
// l'entrée d'historique) et gardé uniquement dans l'état du composant : jamais dans le
// stockage du navigateur, les journaux ou l'URL, et envoyé seulement à POST /reset-password.
// La page fonctionne connecté ou non (elle n'est pas derrière GuestRoute).
export default function ResetPasswordPage() {
  const { t } = useI18n()
  useDocumentTitle(t('auth.reset.title'))
  useNoReferrer()
  const location = useLocation()
  const navigate = useNavigate()
  const { logout } = useAuth()

  const [token] = useState(() => readResetToken(location.search))
  useEffect(() => {
    if (location.search || location.hash) {
      navigate({ pathname: location.pathname, search: '', hash: '' }, { replace: true })
    }
  }, [location.pathname, location.search, location.hash, navigate])

  const form = useFormErrors<ResetField>()

  const { summaryRef } = form
  const [values, setValues] = useState<Record<ResetField, string>>({
    password: '',
    confirmPassword: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [invalidToken, setInvalidToken] = useState(false)
  const invalidHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (invalidToken) invalidHeadingRef.current?.focus()
  }, [invalidToken])

  const onChange = (field: ResetField) => (event: ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }))
    form.clearField(field)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || submitting) return

    const validationErrors = validateReset(values)
    if (Object.keys(validationErrors).length > 0) {
      form.fail(validationErrors)
      return
    }

    setSubmitting(true)
    form.clear()
    try {
      await resetPassword(token, values.password)
      // Le serveur a révoqué tous les refresh tokens du compte : on ferme aussi la session
      // locale éventuelle, sans reconnecter automatiquement.
      logout()
      const state: LoginLocationState = { passwordReset: true }
      navigate('/login', { replace: true, state })
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        if (getErrorCode(error.body) === 'invalid_reset_token') {
          setInvalidToken(true)
          return
        }
        const fieldErrors = serverFieldErrors(
          getFieldErrors(error.body, FIELDS),
          (field) => validateReset(values)[field] ?? null,
          FIELDS,
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

  if (!token || invalidToken) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle ref={invalidHeadingRef} tabIndex={-1} className="outline-none">
            {t(invalidToken ? 'auth.reset.invalidTitle' : 'auth.reset.missingTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p role={invalidToken ? 'alert' : undefined} className="text-sm">
            {t(invalidToken ? 'auth.reset.invalid' : 'auth.reset.missing')}
          </p>
        </CardContent>
        <CardFooter className="mt-6 flex-col items-stretch gap-4">
          <Button asChild>
            <Link to="/forgot-password">{t('auth.reset.requestNew')}</Link>
          </Button>
          <Link to="/login" className={linkClass}>
            {t('auth.backToLogin')}
          </Link>
        </CardFooter>
      </Card>
    )
  }

  const tl = (key: MessageKey) => t(key, AUTH_LIMITS)
  const errorOf = (field: ResetField) => {
    const key = form.errors[field]
    return key ? tl(key) : undefined
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t('auth.reset.title')}</CardTitle>
        <CardDescription>{t('auth.reset.description')}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate aria-busy={submitting}>
        <CardContent className="grid gap-5">
          <ErrorSummary ref={summaryRef} items={form.summaryItems(FIELD_IDS, tl)} />
          <TextField
            id={FIELD_IDS.password}
            label={t('auth.fields.newPassword')}
            hint={tl('auth.hints.password')}
            type="password"
            autoComplete="new-password"
            value={values.password}
            onChange={onChange('password')}
            error={errorOf('password')}
          />
          <TextField
            id={FIELD_IDS.confirmPassword}
            label={t('auth.fields.confirmNewPassword')}
            type="password"
            autoComplete="new-password"
            value={values.confirmPassword}
            onChange={onChange('confirmPassword')}
            error={errorOf('confirmPassword')}
          />
        </CardContent>
        <CardFooter className="mt-6 flex-col items-stretch gap-4">
          <Button type="submit" disabled={submitting}>
            {submitting ? t('auth.reset.submitting') : t('auth.reset.submit')}
          </Button>
          <Link to="/login" className={linkClass}>
            {t('auth.backToLogin')}
          </Link>
        </CardFooter>
      </form>
    </Card>
  )
}
