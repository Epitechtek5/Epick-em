import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'

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
import { resetPassword } from '@/lib/api/auth'
import { ApiError, NetworkError } from '@/lib/api/client'
import { useAuth } from '@/lib/auth/auth-context'
import {
  validatePassword,
  validatePasswordConfirmation,
} from '@/lib/validation/auth'

export default function ResetPasswordPage() {
  useDocumentTitle('Choisir un nouveau mot de passe')
  const [params] = useSearchParams()
  const token = params.get('token')
  const { logout } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [passwordError, setPasswordError] = useState<string>()
  const [confirmationError, setConfirmationError] = useState<string>()
  const [formError, setFormError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [succeeded, setSucceeded] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || submitting) return
    const nextPasswordError = validatePassword(password) ?? undefined
    const nextConfirmationError =
      validatePasswordConfirmation(password, confirmation) ?? undefined
    setPasswordError(nextPasswordError)
    setConfirmationError(nextConfirmationError)
    setFormError(undefined)
    if (nextPasswordError || nextConfirmationError) return

    setSubmitting(true)
    try {
      await resetPassword(token, password)
      logout()
      setPassword('')
      setConfirmation('')
      setSucceeded(true)
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.status === 400
          ? 'Ce lien est invalide, expiré ou a déjà été utilisé.'
          : error instanceof NetworkError
            ? 'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.'
            : 'La réinitialisation a échoué. Veuillez réessayer.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Lien de réinitialisation invalide</CardTitle>
          <CardDescription>Ce lien ne contient aucun jeton utilisable.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="w-full">
            <Link to="/login">Retour à la connexion</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  if (succeeded) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Mot de passe modifié</CardTitle>
          <CardDescription>
            Connectez-vous maintenant avec votre nouveau mot de passe.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="w-full">
            <Link to="/login">Retour à la connexion</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Choisir un nouveau mot de passe</CardTitle>
        <CardDescription>Ce lien à usage unique est valable 15 minutes.</CardDescription>
      </CardHeader>
      <form onSubmit={submit} noValidate aria-busy={submitting}>
        <CardContent className="grid gap-5">
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          <TextField
            id="reset-password"
            label="Nouveau mot de passe"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setPasswordError(undefined)
            }}
            error={passwordError}
          />
          <TextField
            id="reset-confirmation"
            label="Confirmer le mot de passe"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value)
              setConfirmationError(undefined)
            }}
            error={confirmationError}
          />
        </CardContent>
        <CardFooter className="mt-6 flex-col items-stretch gap-4">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Réinitialisation…' : 'Réinitialiser le mot de passe'}
          </Button>
          <Link to="/login" className="text-center text-sm text-primary underline">
            Retour à la connexion
          </Link>
        </CardFooter>
      </form>
    </Card>
  )
}
