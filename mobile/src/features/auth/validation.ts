import { z } from 'zod';

export interface RegisterForm {
  username: string;
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

export function normalizeUsername(username: string): string {
  return username.trim();
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

  const passwordError = validateNewPassword(form.password);
  if (passwordError) errors.password = passwordError;

  if (form.confirmPassword !== form.password) {
    errors.confirmPassword = 'validation.match';
  }

  return errors;
}
