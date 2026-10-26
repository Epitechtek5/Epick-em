export interface RegisterForm {
  username: string;
  password: string;
  confirmPassword: string;
}

export type RegisterErrors = Partial<Record<keyof RegisterForm, string>>;

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;

export function validateRegisterForm(form: RegisterForm): RegisterErrors {
  const errors: RegisterErrors = {};

  if (!USERNAME_PATTERN.test(form.username)) {
    errors.username = 'Username must contain 3–32 letters, numbers, _, . or -.';
  }

  if (form.password.length < 8 || form.password.length > 128) {
    errors.password = 'Password must contain 8–128 characters.';
  }

  if (form.confirmPassword !== form.password) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  return errors;
}
