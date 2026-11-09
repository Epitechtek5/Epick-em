import type { MessageKey } from '@/i18n/context'

// Règles identiques au backend (POST /register, /login, /forgot-password, /reset-password).
export const USERNAME_MIN = 3
export const USERNAME_MAX = 32
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128
export const EMAIL_MAX = 254

// Paramètres des messages de validation (bornes affichées dans les textes).
export const AUTH_LIMITS = {
  usernameMin: USERNAME_MIN,
  usernameMax: USERNAME_MAX,
  passwordMin: PASSWORD_MIN,
  passwordMax: PASSWORD_MAX,
} as const

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]+$/
// Espaces (y compris Unicode) et caractères de contrôle, refusés par le serveur.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_IN_EMAIL = /[\s\u0000-\u001f\u007f-\u009f]/u

const length = (value: string) => [...value].length

// Les validateurs renvoient une clé de traduction (affichée avec AUTH_LIMITS), ou null.
export type ValidationKey = MessageKey

// Forme comparée par le serveur : sans espaces autour, en minuscules. L'adresse est
// pourtant envoyée telle que saisie : le serveur la normalise lui-même.
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

// Miroir de `email_error` (backend) : local@domaine.tld, sans espace, 254 caractères max.
export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value)
  if (length(email) > EMAIL_MAX || FORBIDDEN_IN_EMAIL.test(email)) return false
  const at = email.indexOf('@')
  if (at <= 0) return false
  const domain = email.slice(at + 1)
  if (domain.includes('@')) return false
  const labels = domain.split('.')
  return labels.length >= 2 && labels.every((label) => label.length > 0)
}

export function validateEmail(value: string): ValidationKey | null {
  if (value.trim().length === 0) return 'auth.validation.emailRequired'
  if (!isValidEmail(value)) return 'auth.validation.emailInvalid'
  return null
}

export function validateUsername(value: string): ValidationKey | null {
  if (value.length === 0) return 'auth.validation.usernameRequired'
  if (length(value) < USERNAME_MIN || length(value) > USERNAME_MAX) {
    return 'auth.validation.usernameLength'
  }
  if (!USERNAME_PATTERN.test(value)) return 'auth.validation.usernameFormat'
  return null
}

export function validatePassword(value: string): ValidationKey | null {
  if (value.length === 0) return 'auth.validation.passwordRequired'
  if (length(value) < PASSWORD_MIN || length(value) > PASSWORD_MAX) {
    return 'auth.validation.passwordLength'
  }
  return null
}

export function validatePasswordConfirmation(
  password: string,
  confirmation: string,
): ValidationKey | null {
  if (confirmation.length === 0) return 'auth.validation.confirmRequired'
  if (confirmation !== password) return 'auth.validation.confirmMismatch'
  return null
}

export type FieldErrors<F extends string> = Partial<Record<F, ValidationKey>>

function collect<F extends string>(
  checks: Array<[F, ValidationKey | null]>,
): FieldErrors<F> {
  const errors: FieldErrors<F> = {}
  for (const [field, error] of checks) if (error) errors[field] = error
  return errors
}

export type RegisterField = 'username' | 'email' | 'password' | 'confirmPassword'

export function validateRegister(values: Record<RegisterField, string>): FieldErrors<RegisterField> {
  return collect<RegisterField>([
    ['username', validateUsername(values.username)],
    ['email', validateEmail(values.email)],
    ['password', validatePassword(values.password)],
    ['confirmPassword', validatePasswordConfirmation(values.password, values.confirmPassword)],
  ])
}

export type LoginField = 'email' | 'password'

// À la connexion, on ne rejoue pas les règles de création du mot de passe.
export function validateLogin(values: Record<LoginField, string>): FieldErrors<LoginField> {
  return collect<LoginField>([
    ['email', validateEmail(values.email)],
    ['password', values.password.length === 0 ? 'auth.validation.passwordRequired' : null],
  ])
}

export type ResetField = 'password' | 'confirmPassword'

// Mêmes règles qu'à l'inscription.
export function validateReset(values: Record<ResetField, string>): FieldErrors<ResetField> {
  return collect<ResetField>([
    ['password', validatePassword(values.password)],
    ['confirmPassword', validatePasswordConfirmation(values.password, values.confirmPassword)],
  ])
}

export type EnrollField = 'username' | 'password' | 'email'

// Ajout d'une adresse à un ancien compte : le mot de passe existant n'est pas rejugé.
export function validateEnroll(values: Record<EnrollField, string>): FieldErrors<EnrollField> {
  return collect<EnrollField>([
    ['username', values.username.length === 0 ? 'auth.validation.usernameRequired' : null],
    ['password', values.password.length === 0 ? 'auth.validation.passwordRequired' : null],
    ['email', validateEmail(values.email)],
  ])
}

// Erreurs par champ renvoyées par le serveur (400) : on rejoue la règle locale pour
// afficher un message traduit, sinon un message générique « refusé par le serveur ».
const REJECTED: Record<string, ValidationKey> = {
  username: 'auth.validation.usernameRejected',
  email: 'auth.validation.emailInvalid',
  password: 'auth.validation.passwordLength',
}

export function serverFieldErrors<F extends string>(
  serverErrors: Record<string, string>,
  local: (field: F) => ValidationKey | null,
  fields: readonly F[],
): FieldErrors<F> {
  const errors: FieldErrors<F> = {}
  for (const field of fields) {
    if (!(field in serverErrors)) continue
    errors[field] = local(field) ?? REJECTED[field] ?? 'auth.errors.rejected'
  }
  return errors
}
