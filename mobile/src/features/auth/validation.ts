import { z } from 'zod';

export interface RegisterForm {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export type RegisterErrors = Partial<Record<keyof RegisterForm, string>>;

const usernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_.-]+$/);

const passwordSchema = z
  .string()
  .refine((password) => {
    const length = Array.from(password).length;
    return length >= 8 && length <= 128;
  }, 'validation.passwordLength')
  .regex(/[0-9]/, 'validation.passwordDigit')
  .regex(/[A-Z]/, 'validation.passwordUppercase')
  .regex(/[^A-Za-z0-9]/, 'validation.passwordSpecial');

const emailSchema = z.string().refine((value) => {
  const email = normalizeEmail(value);
  if (Array.from(email).length > 254 || /[\s\p{Cc}]/u.test(email)) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const labels = email.slice(at + 1).split('.');
  return labels.length >= 2 && labels.every(Boolean);
}, 'validation.email');

export function normalizeUsername(username: string): string {
  return username.trim();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): string | null {
  return emailSchema.safeParse(email).success ? null : 'validation.email';
}

export function validateUsername(username: string): string | null {
  return usernameSchema.safeParse(normalizeUsername(username)).success
    ? null
    : 'validation.username';
}

export function validateNewPassword(password: string): string | null {
  const result = passwordSchema.safeParse(password);
  return result.success ? null : (result.error.issues[0]?.message ?? null);
}

export function validateRegisterForm(form: RegisterForm): RegisterErrors {
  const errors: RegisterErrors = {};

  const usernameError = validateUsername(form.username);
  if (usernameError) errors.username = usernameError;

  const emailError = validateEmail(form.email);
  if (emailError) errors.email = emailError;

  const passwordError = validateNewPassword(form.password);
  if (passwordError) errors.password = passwordError;

  if (form.confirmPassword !== form.password) {
    errors.confirmPassword = 'validation.match';
  }

  return errors;
}
