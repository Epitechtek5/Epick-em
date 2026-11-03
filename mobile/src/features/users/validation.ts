import type { UserRole } from './api';
import {
  normalizeUsername,
  validateEmail,
  validateNewPassword,
  validateUsername,
} from '@/features/auth/validation';

export interface UserFormValues {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: UserRole;
}

export type UserFormErrors = Partial<
  Record<'username' | 'email' | 'password' | 'confirmPassword', string>
>;

export function validateUserForm(
  form: UserFormValues,
  originalUsername: string,
  originalEmail?: string | null,
): UserFormErrors {
  const errors: UserFormErrors = {};

  const username = normalizeUsername(form.username);
  if (username !== originalUsername) {
    const usernameError = validateUsername(username);
    if (usernameError) errors.username = usernameError;
  }

  if (form.email.trim()) {
    const emailError = validateEmail(form.email);
    if (emailError) errors.email = emailError;
  } else if (originalEmail) {
    errors.email = 'validation.emailRemovalUnsupported';
  }

  if (form.password) {
    const passwordError = validateNewPassword(form.password);
    if (passwordError) errors.password = passwordError;
  }

  if (form.password !== form.confirmPassword) {
    errors.confirmPassword = 'validation.match';
  }

  return errors;
}
