import { useState, type FormEvent, type ReactNode } from 'react'

import { ResendVerification } from '@/components/auth/ResendVerification'
import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { ErrorSummary } from '@/components/form/ErrorSummary'
import { TextField } from '@/components/form/TextField'
import { useFormErrors } from '@/components/form/use-form-errors'
import { StateMessage } from '@/components/games/StateMessage'
import { Button } from '@/components/ui/button'
import {
  deleteAccount,
  updateEmail,
  updatePassword,
  updatePicture,
  updateUsername,
  validatePictureUrl,
  type SelfProfile,
} from '@/features/account/api'
import { useI18n, type MessageKey } from '@/i18n/context'
import { login as loginRequest } from '@/lib/api/auth'
import { ApiError, NetworkError } from '@/lib/api/client'
import { getErrorCode, getFieldErrors } from '@/lib/api/errors'
import { useAuth } from '@/lib/auth/auth-context'
import { endSession, refreshSession } from '@/lib/auth/session'
import {
  AUTH_LIMITS,
  normalizeEmail,
  serverFieldErrors,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
  validateUsername,
} from '@/lib/validation/auth'

interface ProfileFormProps {
  profile: SelfProfile
  onUpdated: (profile: SelfProfile) => void
}

// Erreur générique d'une requête de compte (hors erreurs de champ).
function requestErrorKey(error: unknown): MessageKey {
  if (error instanceof NetworkError) return 'auth.errors.network'
  if (error instanceof ApiError && error.status === 400) return 'auth.errors.rejected'
  return 'auth.errors.unexpected'
}

// Message de réussite annoncé (aria-live) au-dessus d'un formulaire.
function Success({ children }: { children: ReactNode }) {
  return (
    <div aria-live="polite">
      {children ? <p className="rounded-lg border border-primary p-4 text-sm">{children}</p> : null}
    </div>
  )
}

// Nom d'utilisateur (PATCH /me/update { username }). Le nom affiché vient du jeton d'accès :
// la session est renouvelée après le changement pour mettre l'en-tête à jour.
export function UsernameForm({ profile, onUpdated }: ProfileFormProps) {
  const { t } = useI18n()
  const form = useFormErrors<'username'>()
  const { summaryRef } = form
  const [username, setUsername] = useState(profile.username)
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(false)
  const tl = (key: MessageKey) => t(key, AUTH_LIMITS)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSaved(false)
    const value = username.trim()
    const error = value === profile.username ? 'account.usernameForm.unchanged' : validateUsername(value)
    if (error) {
      form.fail({ username: error })
      return
    }
    setSubmitting(true)
    form.clear()
    try {
      const updated = await updateUsername(value)
      onUpdated(updated)
      setUsername(updated.username)
      setSaved(true)
      await refreshSession().catch(() => {})
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        form.fail({ username: 'auth.validation.usernameTaken' })
      } else if (error instanceof ApiError && error.status === 400) {
        const fieldErrors = serverFieldErrors(getFieldErrors(error.body, ['username']), () => validateUsername(value), ['username'])
        form.fail(fieldErrors, Object.keys(fieldErrors).length > 0 ? null : 'auth.errors.rejected')
      } else {
        form.fail({}, requestErrorKey(error))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={submitting} aria-label={t('account.usernameForm.title')} className="grid gap-4">
      <Success>{saved ? t('account.usernameForm.saved') : null}</Success>
      <ErrorSummary ref={summaryRef} items={form.summaryItems({ username: 'account-username' }, tl)} />
      <TextField
        id="account-username"
        label={t('auth.fields.username')}
        hint={tl('auth.hints.username')}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        value={username}
        onChange={(event) => {
          setUsername(event.target.value)
          form.clearField('username')
        }}
        error={form.errors.username ? tl(form.errors.username) : undefined}
      />
      <div>
        <Button type="submit" disabled={submitting}>
          {submitting ? t('account.usernameForm.saving') : t('account.usernameForm.submit')}
        </Button>
      </div>
    </form>
  )
}

// Photo de profil : URL http(s) (comme les équipes), visible des autres comptes. Une
// valeur vide ou « Retirer la photo » l'efface ; sans photo, les initiales s'affichent.
export function PictureForm({ profile, onUpdated }: ProfileFormProps) {
  const { t } = useI18n()
  const form = useFormErrors<'picture'>()
  const { summaryRef } = form
  const current = profile.picture_url ?? ''
  const [url, setUrl] = useState(current)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<'saved' | 'removed' | null>(null)

  async function save(next: string) {
    if (submitting) return
    setDone(null)
    const error = validatePictureUrl(next)
    if (error) {
      form.fail({ picture: error })
      return
    }
    if (next.trim() === current) {
      form.fail({ picture: 'account.picture.unchanged' })
      return
    }
    setSubmitting(true)
    form.clear()
    try {
      const updated = await updatePicture(next)
      onUpdated(updated)
      setUrl(updated.picture_url ?? '')
      setDone(updated.picture_url ? 'saved' : 'removed')
    } catch (error) {
      const invalid = error instanceof ApiError && error.status === 400 && getFieldErrors(error.body, ['picture_url']).picture_url
      if (invalid) form.fail({ picture: 'account.picture.invalid' })
      else form.fail({}, requestErrorKey(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void save(url)
      }}
      noValidate
      aria-busy={submitting}
      aria-label={t('account.picture.title')}
      className="grid gap-4"
    >
      <Success>{done ? t(done === 'saved' ? 'account.picture.saved' : 'account.picture.removed') : null}</Success>
      <ErrorSummary ref={summaryRef} items={form.summaryItems({ picture: 'account-picture' }, t)} />
      <TextField
        id="account-picture"
        label={t('account.picture.url')}
        hint={t('account.picture.hint')}
        type="url"
        inputMode="url"
        autoComplete="photo"
        autoCapitalize="none"
        spellCheck={false}
        required={false}
        value={url}
        onChange={(event) => {
          setUrl(event.target.value)
          form.clearField('picture')
        }}
        error={form.errors.picture ? t(form.errors.picture) : undefined}
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? t('account.picture.saving') : t('account.picture.save')}
        </Button>
        {current ? (
          <Button type="button" variant="outline" disabled={submitting} onClick={() => void save('')}>
            {t('account.picture.remove')}
          </Button>
        ) : null}
      </div>
    </form>
  )
}

// Adresse e-mail : état (confirmée, en attente, nouvelle adresse), renvoi du lien de
// confirmation et changement (PATCH /me/update { email }). Le champ n'est jamais pré-rempli.
export function EmailForm({ profile, onUpdated }: ProfileFormProps) {
  const { t } = useI18n()
  const form = useFormErrors<'email'>()
  const { summaryRef } = form
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const awaiting = profile.pending_email ?? (profile.email && !profile.email_verified_at ? profile.email : null)

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
        const fieldErrors = serverFieldErrors(getFieldErrors(error.body, ['email']), () => validateEmail(email), ['email'])
        form.fail(fieldErrors, Object.keys(fieldErrors).length > 0 ? null : 'auth.errors.rejected')
      } else {
        form.fail({}, requestErrorKey(error))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-5">
      <dl className="grid gap-1 text-sm">
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
            <span className="break-all">{t('account.pending', { email: profile.pending_email })}</span>
          ) : null}
        </dd>
      </dl>
      {awaiting ? <ResendVerification email={awaiting} /> : null}
      <form onSubmit={onSubmit} noValidate aria-busy={submitting} aria-label={t('account.changeTitle')} className="grid gap-4">
        <Success>{sentTo ? t('account.updated', { email: sentTo }) : null}</Success>
        <ErrorSummary ref={summaryRef} items={form.summaryItems({ email: 'account-email' }, t)} />
        <TextField
          id="account-email"
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
        <div>
          <Button type="submit" disabled={submitting}>
            {submitting ? t('account.submitting') : t('account.submit')}
          </Button>
        </div>
      </form>
    </div>
  )
}

type PasswordField = 'current' | 'password' | 'confirmPassword'
const PASSWORD_IDS: Record<PasswordField, string> = {
  current: 'account-current-password',
  password: 'account-new-password',
  confirmPassword: 'account-confirm-password',
}

// Mot de passe. Le serveur ne redemande pas l'ancien mot de passe : il est vérifié ici par une
// connexion (POST /login) avant le changement (PATCH /me/update { password }). Le serveur
// fermant alors toutes les sessions, une nouvelle session est ouverte avec le nouveau mot de passe.
export function PasswordForm({ profile }: { profile: SelfProfile }) {
  const { t } = useI18n()
  const { login } = useAuth()
  const form = useFormErrors<PasswordField>()
  const { summaryRef } = form
  const [values, setValues] = useState<Record<PasswordField, string>>({ current: '', password: '', confirmPassword: '' })
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(false)
  const tl = (key: MessageKey) => t(key, AUTH_LIMITS)
  const email = profile.email

  if (!email) return <p className="text-sm text-muted-foreground">{t('account.passwordForm.noEmail')}</p>

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || !email) return
    setSaved(false)
    const errors: Partial<Record<PasswordField, MessageKey>> = {}
    if (!values.current) errors.current = 'account.passwordForm.currentRequired'
    const passwordError = validatePassword(values.password)
    if (passwordError) errors.password = passwordError
    else if (values.password === values.current) errors.password = 'account.passwordForm.same'
    const confirmError = validatePasswordConfirmation(values.password, values.confirmPassword)
    if (confirmError) errors.confirmPassword = confirmError
    if (Object.keys(errors).length > 0) {
      form.fail(errors)
      return
    }

    setSubmitting(true)
    form.clear()
    try {
      try {
        await loginRequest({ email, password: values.current })
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          form.fail({ current: 'account.passwordForm.currentInvalid' })
          return
        }
        throw error
      }
      await updatePassword(values.password)
      try {
        await login({ email, password: values.password })
      } catch {
        // Le mot de passe a changé mais la nouvelle session n'a pas pu s'ouvrir.
        endSession('passwordChanged')
        return
      }
      setValues({ current: '', password: '', confirmPassword: '' })
      setSaved(true)
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        const fieldErrors = serverFieldErrors(getFieldErrors(error.body, ['password']), () => validatePassword(values.password), ['password'])
        form.fail(fieldErrors, Object.keys(fieldErrors).length > 0 ? null : 'auth.errors.rejected')
      } else {
        form.fail({}, requestErrorKey(error))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const field = (name: PasswordField, label: MessageKey, autoComplete: string, hint?: string) => (
    <TextField
      id={PASSWORD_IDS[name]}
      label={t(label)}
      hint={hint}
      type="password"
      autoComplete={autoComplete}
      value={values[name]}
      onChange={(event) => {
        const value = event.target.value
        setValues((current) => ({ ...current, [name]: value }))
        form.clearField(name)
      }}
      error={form.errors[name] ? tl(form.errors[name]) : undefined}
    />
  )

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={submitting} aria-label={t('account.passwordForm.title')} className="grid gap-4">
      <Success>{saved ? t('account.passwordForm.saved') : null}</Success>
      <ErrorSummary ref={summaryRef} items={form.summaryItems(PASSWORD_IDS, tl)} />
      {/* Champ masqué pour les gestionnaires de mots de passe (identifiant du compte). */}
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      {field('current', 'account.passwordForm.current', 'current-password')}
      {field('password', 'auth.fields.newPassword', 'new-password', tl('auth.hints.password'))}
      {field('confirmPassword', 'auth.fields.confirmNewPassword', 'new-password')}
      <p className="text-sm text-muted-foreground">{t('account.passwordForm.hint')}</p>
      <div>
        <Button type="submit" disabled={submitting}>
          {submitting ? t('account.passwordForm.saving') : t('account.passwordForm.submit')}
        </Button>
      </div>
    </form>
  )
}

// Suppression définitive du compte (DELETE /me/delete), après confirmation explicite.
export function DeleteAccount() {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await deleteAccount()
      endSession('accountDeleted')
    } catch (caught) {
      setError(requestErrorKey(caught))
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('account.deleteForm.description')}</p>
      {error ? <StateMessage kind="error">{t(error)}</StateMessage> : null}
      <div>
        <ConfirmDeleteDialog
          label={t('account.deleteForm.submit')}
          busyLabel={t('account.deleteForm.deleting')}
          title={t('account.deleteForm.confirmTitle')}
          description={t('account.deleteForm.confirm')}
          busy={busy}
          onConfirm={() => void remove()}
        />
      </div>
    </div>
  )
}
