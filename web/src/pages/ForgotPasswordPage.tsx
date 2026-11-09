import { useEffect, useRef, useState, type FormEvent } from 'react'
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
import { useNoReferrer } from '@/hooks/use-no-referrer'
import { useI18n } from '@/i18n/context'
import { forgotPassword } from '@/lib/api/auth'
import { ApiError, NetworkError } from '@/lib/api/client'
import { validateEmail } from '@/lib/validation/auth'

const FIELD_IDS = { email: 'forgot-email' }
const linkClass = 'text-center text-sm text-primary underline underline-offset-2'

// Demande d'un lien de réinitialisation. Le message de confirmation est toujours le même,
// que l'adresse corresponde à un compte ou non : la page ne révèle jamais qu'un compte existe.
export default function ForgotPasswordPage() {
  const { t } = useI18n()
  useDocumentTitle(t('auth.forgot.title'))
  useNoReferrer()
  const form = useFormErrors<'email'>()
  const { summaryRef } = form
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const sentHeadingRef = useRef<HTMLHeadingElement>(null)

  // Le focus suit le changement d'écran (WCAG 2.4.3) ; le statut est aussi annoncé.
  useEffect(() => {
    if (sent) sentHeadingRef.current?.focus()
  }, [sent])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const emailError = validateEmail(email)
    if (emailError) {
      form.fail({ email: emailError })
      return
    }

    setSubmitting(true)
    form.clear()
    try {
      await forgotPassword(email)
      setSent(true)
    } catch (error) {
      // Seule une adresse mal formée produit un 400 ; rien ne dépend de l'existence du compte.
      if (error instanceof ApiError && error.status === 400) {
        form.fail({ email: 'auth.validation.emailInvalid' })
      } else if (error instanceof NetworkError) {
        form.fail({}, 'auth.errors.network')
      } else {
        form.fail({}, 'auth.errors.unexpected')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle ref={sentHeadingRef} tabIndex={-1} className="outline-none">
            {t('auth.forgot.sentTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p role="status">{t('auth.forgot.sent')}</p>
          <p className="text-muted-foreground">{t('auth.forgot.sentHint')}</p>
        </CardContent>
        <CardFooter className="mt-6 flex-col items-stretch gap-4">
          <Button type="button" variant="outline" onClick={() => setSent(false)}>
            {t('auth.forgot.again')}
          </Button>
          <Link to="/login" className={linkClass}>
            {t('auth.backToLogin')}
          </Link>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t('auth.forgot.title')}</CardTitle>
        <CardDescription>{t('auth.forgot.description')}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate aria-busy={submitting}>
        <CardContent className="grid gap-5">
          <ErrorSummary ref={summaryRef} items={form.summaryItems(FIELD_IDS, t)} />
          <TextField
            id={FIELD_IDS.email}
            label={t('auth.fields.email')}
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
        <CardFooter className="mt-6 flex-col items-stretch gap-4">
          <Button type="submit" disabled={submitting}>
            {submitting ? t('auth.forgot.submitting') : t('auth.forgot.submit')}
          </Button>
          <Link to="/login" className={linkClass}>
            {t('auth.backToLogin')}
          </Link>
        </CardFooter>
      </form>
    </Card>
  )
}
