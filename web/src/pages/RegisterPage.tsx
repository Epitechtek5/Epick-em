import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

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
import { register } from '@/lib/api/auth'
import { ApiError, NetworkError } from '@/lib/api/client'
import { getErrorMessage, getFieldErrors } from '@/lib/api/errors'
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  validateRegister,
  type FieldErrors,
  type RegisterField,
} from '@/lib/validation/auth'

const FIELD_IDS: Record<RegisterField, string> = {
  username: 'register-username',
  password: 'register-password',
  confirmPassword: 'register-confirm-password',
}

export default function RegisterPage() {
  useDocumentTitle('Créer un compte')
  const navigate = useNavigate()
  const summaryRef = useRef<HTMLDivElement>(null)

  const [values, setValues] = useState({
    username: '',
    password: '',
    confirmPassword: '',
  })
  const [errors, setErrors] = useState<FieldErrors<RegisterField>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [errorVersion, setErrorVersion] = useState(0)

  // Après chaque soumission en erreur, le focus va sur le résumé des erreurs.
  useEffect(() => {
    if (errorVersion > 0) summaryRef.current?.focus()
  }, [errorVersion])

  const fail = (
    nextErrors: FieldErrors<RegisterField>,
    nextFormError: string | null,
  ) => {
    setErrors(nextErrors)
    setFormError(nextFormError)
    setErrorVersion((version) => version + 1)
  }

  const onChange =
    (field: RegisterField) => (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [field]: event.target.value }))

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const validationErrors = validateRegister(values)
    if (Object.keys(validationErrors).length > 0) {
      fail(validationErrors, null)
      return
    }

    setSubmitting(true)
    setErrors({})
    setFormError(null)
    try {
      await register({ username: values.username, password: values.password })
      navigate('/login', { replace: true, state: { registered: true } })
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        fail({ username: "Ce nom d'utilisateur est déjà utilisé. Choisissez-en un autre." }, null)
      } else if (error instanceof ApiError && error.status === 400) {
        const fieldErrors = getFieldErrors(error.body, ['username', 'password'])
        const message = getErrorMessage(error.body)
        fail(
          fieldErrors,
          Object.keys(fieldErrors).length > 0
            ? null
            : (message ??
                'Les informations saisies sont refusées par le serveur. Vérifiez-les et réessayez.'),
        )
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
    ...(Object.keys(FIELD_IDS) as RegisterField[]).flatMap((field) =>
      errors[field] ? [{ fieldId: FIELD_IDS[field], message: errors[field] }] : [],
    ),
    ...(formError ? [{ message: formError }] : []),
  ]

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Créer un compte</CardTitle>
        <CardDescription>Tous les champs sont obligatoires.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate aria-busy={submitting}>
        <CardContent className="grid gap-5">
          <ErrorSummary ref={summaryRef} items={summaryItems} />
          <TextField
            id={FIELD_IDS.username}
            label="Nom d'utilisateur"
            hint={`${USERNAME_MIN} à ${USERNAME_MAX} caractères : lettres, chiffres, _ . -`}
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
            hint={`${PASSWORD_MIN} à ${PASSWORD_MAX} caractères.`}
            autoComplete="new-password"
            value={values.password}
            onChange={onChange('password')}
            error={errors.password}
          />
          <TextField
            id={FIELD_IDS.confirmPassword}
            label="Confirmation du mot de passe"
            type="password"
            autoComplete="new-password"
            value={values.confirmPassword}
            onChange={onChange('confirmPassword')}
            error={errors.confirmPassword}
          />
        </CardContent>
        <CardFooter className="mt-6 flex-col items-stretch gap-4">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Création en cours…' : 'Créer mon compte'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Déjà un compte ?{' '}
            <Link to="/login" className="text-primary underline underline-offset-2">
              Se connecter
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
