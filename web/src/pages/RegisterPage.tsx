import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

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
import { register } from '@/lib/api/auth'
import { ApiError, NetworkError } from '@/lib/api/client'
import { getErrorCode, getFieldErrors } from '@/lib/api/errors'
import {
  AUTH_LIMITS,
  serverFieldErrors,
  validateRegister,
  type RegisterField,
} from '@/lib/validation/auth'
import type { LoginLocationState } from './LoginPage'

const FIELD_IDS: Record<RegisterField, string> = {
  username: 'register-username',
  email: 'register-email',
  password: 'register-password',
  confirmPassword: 'register-confirm-password',
}
const FIELDS = Object.keys(FIELD_IDS) as RegisterField[]

export default function RegisterPage() {
  const { t } = useI18n()
  useDocumentTitle(t('auth.register.title'))
  const navigate = useNavigate()
  const form = useFormErrors<RegisterField>()
  const { summaryRef } = form

  const [values, setValues] = useState<Record<RegisterField, string>>({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [submitting, setSubmitting] = useState(false)

  const onChange = (field: RegisterField) => (event: ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }))
    form.clearField(field)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const validationErrors = validateRegister(values)
    if (Object.keys(validationErrors).length > 0) {
      form.fail(validationErrors)
      return
    }

    setSubmitting(true)
    form.clear()
    try {
      // L'adresse part telle que saisie : le serveur la normalise (trim, minuscules).
      await register({ username: values.username, email: values.email, password: values.password })
      const state: LoginLocationState = { registered: true, email: values.email.trim() }
      navigate('/login', { replace: true, state })
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        if (getErrorCode(error.body) === 'email_taken') {
          form.fail({ email: 'auth.validation.emailTaken' })
        } else {
          form.fail({ username: 'auth.validation.usernameTaken' })
        }
      } else if (error instanceof ApiError && error.status === 400) {
        const fieldErrors = serverFieldErrors(
          getFieldErrors(error.body, FIELDS),
          (field) => validateRegister(values)[field] ?? null,
          FIELDS,
        )
        form.fail(fieldErrors, Object.keys(fieldErrors).length > 0 ? null : 'auth.errors.rejected')
      } else if (error instanceof ApiError && error.status === 429) {
        form.fail({}, 'auth.errors.tooManyRequests')
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
  const errorOf = (field: RegisterField) => {
    const key = form.errors[field]
    return key ? tl(key) : undefined
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t('auth.register.title')}</CardTitle>
        <CardDescription>{t('auth.register.description')}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate aria-busy={submitting}>
        <CardContent className="grid gap-5">
          <ErrorSummary ref={summaryRef} items={form.summaryItems(FIELD_IDS, tl)} />
          <TextField
            id={FIELD_IDS.username}
            label={t('auth.fields.username')}
            hint={tl('auth.hints.username')}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={values.username}
            onChange={onChange('username')}
            error={errorOf('username')}
          />
          <TextField
            id={FIELD_IDS.email}
            label={t('auth.fields.email')}
            hint={t('auth.hints.email')}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={values.email}
            onChange={onChange('email')}
            error={errorOf('email')}
          />
          <TextField
            id={FIELD_IDS.password}
            label={t('auth.fields.password')}
            type="password"
            hint={tl('auth.hints.password')}
            autoComplete="new-password"
            value={values.password}
            onChange={onChange('password')}
            error={errorOf('password')}
          />
          <TextField
            id={FIELD_IDS.confirmPassword}
            label={t('auth.fields.confirmPassword')}
            type="password"
            autoComplete="new-password"
            value={values.confirmPassword}
            onChange={onChange('confirmPassword')}
            error={errorOf('confirmPassword')}
          />
        </CardContent>
        <CardFooter className="mt-6 flex-col items-stretch gap-4">
          <Button type="submit" disabled={submitting}>
            {submitting ? t('auth.register.submitting') : t('auth.register.submit')}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t('auth.register.hasAccount')}{' '}
            <Link to="/login" className="text-primary underline underline-offset-2">
              {t('auth.register.login')}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
