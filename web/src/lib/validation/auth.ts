// Règles identiques au backend (POST /register).
export const USERNAME_MIN = 3
export const USERNAME_MAX = 32
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]+$/

const length = (value: string) => [...value].length

export function validateUsername(value: string): string | null {
  if (value.length === 0) return "Saisissez un nom d'utilisateur."
  if (length(value) < USERNAME_MIN || length(value) > USERNAME_MAX) {
    return `Le nom d'utilisateur doit contenir entre ${USERNAME_MIN} et ${USERNAME_MAX} caractères.`
  }
  if (!USERNAME_PATTERN.test(value)) {
    return "Le nom d'utilisateur ne peut contenir que des lettres, des chiffres et les caractères _ . -"
  }
  return null
}

export function validatePassword(value: string): string | null {
  if (value.length === 0) return 'Saisissez un mot de passe.'
  if (length(value) < PASSWORD_MIN || length(value) > PASSWORD_MAX) {
    return `Le mot de passe doit contenir entre ${PASSWORD_MIN} et ${PASSWORD_MAX} caractères.`
  }
  return null
}

export function validatePasswordConfirmation(
  password: string,
  confirmation: string,
): string | null {
  if (confirmation.length === 0) return 'Confirmez votre mot de passe.'
  if (confirmation !== password) {
    return 'Les deux mots de passe ne correspondent pas.'
  }
  return null
}

export type RegisterField = 'username' | 'password' | 'confirmPassword'
export type LoginField = 'username' | 'password'
export type FieldErrors<F extends string> = Partial<Record<F, string>>

export function validateRegister(values: {
  username: string
  password: string
  confirmPassword: string
}): FieldErrors<RegisterField> {
  const errors: FieldErrors<RegisterField> = {}
  const username = validateUsername(values.username)
  const password = validatePassword(values.password)
  const confirmPassword = validatePasswordConfirmation(
    values.password,
    values.confirmPassword,
  )
  if (username) errors.username = username
  if (password) errors.password = password
  if (confirmPassword) errors.confirmPassword = confirmPassword
  return errors
}

// À la connexion, on ne rejoue pas les règles de création : champs requis seulement.
export function validateLogin(values: {
  username: string
  password: string
}): FieldErrors<LoginField> {
  const errors: FieldErrors<LoginField> = {}
  if (values.username.length === 0) {
    errors.username = "Saisissez votre nom d'utilisateur."
  }
  if (values.password.length === 0) {
    errors.password = 'Saisissez votre mot de passe.'
  }
  return errors
}
