import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router'

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
import { enrollEmail } from '@/lib/api/auth'
import { ApiError, NetworkError } from '@/lib/api/client'
import { getErrorCode, getFieldErrors } from '@/lib/api/errors'
import {
  AUTH_LIMITS,
  serverFieldErrors,
  validateEnroll,
  type EnrollField,
} from '@/lib/validation/auth'

const FIELD_IDS: Record<EnrollField, string> = {
  username: 'enroll-username',
  password: 'enroll-password',
  email: 'enroll-email',
}
const FIELDS = Object.keys(FIELD_IDS) as EnrollField[]
const linkClass = 'text-center text-sm text-primary underline underline-offset-2'

// Comptes créés avant l'e-mail obligatoire : la connexion se fait désormais par adresse,
// ils rattachent donc une adresse (POST /enroll-email) puis la confirment par lien.
export default function EnrollEmailPage() {
  const { t } = useI18n()
  useDocumentTitle(t('auth.enroll.title'))
  const form = useFormErrors<EnrollField>()
  const { summaryRef } = form
  const [values, setValues] = useState<Record<EnrollField, string>>({
    username: '',
    password: '',
    email: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const sentHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (sentTo) sentHeadingRef.current?.focus()
  }, [sentTo])

  const onChange = (field: EnrollField) => (event: ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }))
    form.clearField(field)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const validationErrors = validateEnroll(values)
    if (Object.keys(validationErrors).length > 0) {
      form.fail(validationErrors)
      return
    }

    setSubmitting(true)
    form.clear()
    try {
      await enrollEmail(values)
      setValues((current) => ({ ...current, password: '' }))
      setSentTo(values.email.trim())
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        form.fail({}, 'auth.enroll.invalidCredentials')
      } else if (error instanceof ApiError && error.status === 409 && getErrorCode(error.body) === 'email_taken') {
        form.fail({ email: 'auth.validation.emailTaken' })
      } else if (error instanceof ApiError && error.status === 400) {
        const fieldErrors = serverFieldErrors(
          getFieldErrors(error.body, FIELDS),
          (field) => validateEnroll(values)[field] ?? null,
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

  if (sentTo) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle ref={sentHeadingRef} tabIndex={-1} className="outline-none">
            {t('auth.enroll.sentTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p role="status" className="text-sm">
            {t('auth.enroll.sent', { email: sentTo })}
          </p>
        </CardContent>
        <CardFooter className="mt-6 flex-col items-stretch gap-4">
          <Button asChild>
            <Link to="/login" state={{ email: sentTo }}>
              {t('auth.backToLogin')}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  const tl = (key: MessageKey) => t(key, AUTH_LIMITS)
  const errorOf = (field: EnrollField) => {
    const key = form.errors[field]
    return key ? tl(key) : undefined
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t('auth.enroll.title')}</CardTitle>
        <CardDescription>{t('auth.enroll.description')}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate aria-busy={submitting}>
        <CardContent className="grid gap-5">
          <ErrorSummary ref={summaryRef} items={form.summaryItems(FIELD_IDS, tl)} />
          <TextField
            id={FIELD_IDS.username}
            label={t('auth.fields.username')}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={values.username}
            onChange={onChange('username')}
            error={errorOf('username')}
          />
          <TextField
            id={FIELD_IDS.password}
            label={t('auth.fields.password')}
            type="password"
            autoComplete="current-password"
            value={values.password}
            onChange={onChange('password')}
            error={errorOf('password')}
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
        </CardContent>
        <CardFooter className="mt-6 flex-col items-stretch gap-4">
          <Button type="submit" disabled={submitting}>
            {submitting ? t('auth.enroll.submitting') : t('auth.enroll.submit')}
          </Button>
          <Link to="/login" className={linkClass}>
            {t('auth.backToLogin')}
          </Link>
        </CardFooter>
      </form>
    </Card>
  )
}
