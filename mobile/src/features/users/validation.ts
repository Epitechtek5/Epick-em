import type { UserRole } from './api';
import {
  normalizeUsername,
  validateNewPassword,
  validateUsername,
} from '@/features/auth/validation';

export interface UserFormValues {
  username: string;
  password: string;
  confirmPassword: string;
  role: UserRole;
}

export type UserFormErrors = Partial<
  Record<'username' | 'password' | 'confirmPassword', string>
>;

export function validateUserForm(
  form: UserFormValues,
  originalUsername: string,
): UserFormErrors {
  const errors: UserFormErrors = {};

  const username = normalizeUsername(form.username);
  if (username !== originalUsername) {
    const usernameError = validateUsername(username);
    if (usernameError) errors.username = usernameError;
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
