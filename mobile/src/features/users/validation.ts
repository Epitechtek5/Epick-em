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
    errors.username = 'validation.username';
  }

  if (
    form.password &&
    (Array.from(form.password).length < 8 ||
      Array.from(form.password).length > 128)
  ) {
    errors.password = 'validation.password';
  }

  if (form.password !== form.confirmPassword) {
    errors.confirmPassword = 'validation.match';
  }

  return errors;
}
