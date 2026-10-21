import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { ErrorSummary, type ErrorSummaryItem } from '@/components/form/ErrorSummary'
import { TextField } from '@/components/form/TextField'
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
import { ApiError, NetworkError } from '@/lib/api/client'
import { useAuth } from '@/lib/auth/auth-context'
import {
  validateLogin,
  type FieldErrors,
  type LoginField,
} from '@/lib/validation/auth'

const FIELD_IDS: Record<LoginField, string> = {
  username: 'login-username',
  password: 'login-password',
}

interface LocationState {
  registered?: boolean
  from?: string
}

export default function LoginPage() {
  useDocumentTitle('Connexion')
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as LocationState
  const summaryRef = useRef<HTMLDivElement>(null)

  const [values, setValues] = useState({ username: '', password: '' })
  const [errors, setErrors] = useState<FieldErrors<LoginField>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [errorVersion, setErrorVersion] = useState(0)

  useEffect(() => {
    if (errorVersion > 0) summaryRef.current?.focus()
  }, [errorVersion])

  const fail = (nextErrors: FieldErrors<LoginField>, nextFormError: string | null) => {
    setErrors(nextErrors)
    setFormError(nextFormError)
    setErrorVersion((version) => version + 1)
  }

  const onChange =
    (field: LoginField) => (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [field]: event.target.value }))

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const validationErrors = validateLogin(values)
    if (Object.keys(validationErrors).length > 0) {
      fail(validationErrors, null)
      return
    }

    setSubmitting(true)
    setErrors({})
    setFormError(null)
    try {
      await login(values)
      navigate(state.from ?? '/app', { replace: true })
    } catch (error) {
      if (error instanceof ApiError && (error.status === 400 || error.status === 401)) {
        fail({}, "Nom d'utilisateur ou mot de passe incorrect.")
      } else if (
        error instanceof ApiError &&
        [404, 405, 501].includes(error.status)
      ) {
        // Endpoints JWT pas encore livrés (issue #15).
        fail({}, "La connexion n'est pas encore disponible. Réessayez plus tard.")
      } else if (error instanceof NetworkError) {
        fail({}, 'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.')
      } else {
        fail({}, 'Une erreur inattendue est survenue. Réessayez dans un instant.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const summaryItems: ErrorSummaryItem[] = [
    ...(Object.keys(FIELD_IDS) as LoginField[]).flatMap((field) =>
      errors[field] ? [{ fieldId: FIELD_IDS[field], message: errors[field] }] : [],
    ),
    ...(formError ? [{ message: formError }] : []),
  ]

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Connexion</CardTitle>
        <CardDescription>Tous les champs sont obligatoires.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate aria-busy={submitting}>
        <CardContent className="grid gap-5">
          {state.registered ? (
            <p
              role="status"
              className="rounded-lg border border-primary p-4 text-sm"
            >
              <span className="font-semibold">Compte créé.</span> Vous pouvez
              maintenant vous connecter.
            </p>
          ) : null}
          <ErrorSummary ref={summaryRef} items={summaryItems} />
          <TextField
            id={FIELD_IDS.username}
            label="Nom d'utilisateur"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={values.username}
            onChange={onChange('username')}
            error={errors.username}
          />
          <TextField
            id={FIELD_IDS.password}
            label="Mot de passe"
            type="password"
            autoComplete="current-password"
            value={values.password}
            onChange={onChange('password')}
            error={errors.password}
          />
        </CardContent>
        <CardFooter className="mt-6 flex-col items-stretch gap-4">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Connexion en cours…' : 'Se connecter'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Pas encore de compte ?{' '}
            <Link to="/register" className="text-primary underline underline-offset-2">
              Créer un compte
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
