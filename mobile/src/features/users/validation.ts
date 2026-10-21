import type { UserRole } from './api';

export interface UserFormValues {
  username: string;
  password: string;
  confirmPassword: string;
  role: UserRole;
}

export type UserFormErrors = Partial<
  Record<'username' | 'password' | 'confirmPassword', string>
>;

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;

export function validateUserForm(
  form: UserFormValues,
  originalUsername: string,
): UserFormErrors {
  const errors: UserFormErrors = {};

  if (
    form.username !== originalUsername &&
    !USERNAME_PATTERN.test(form.username)
  ) {
    errors.username = 'Username must contain 3–32 letters, numbers, _, . or -.';
  }

  if (
    form.password &&
    (form.password.length < 8 || form.password.length > 128)
  ) {
    errors.password = 'Password must contain 8–128 characters.';
  }

  if (form.password !== form.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  return errors;
}
