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
    errors.username = 'validation.username';
  }

  if (
    Array.from(form.password).length < 8 ||
    Array.from(form.password).length > 128
  ) {
    errors.password = 'validation.password';
  }

  if (form.confirmPassword !== form.password) {
    errors.confirmPassword = 'validation.match';
  }

  return errors;
}
