import { validateRegisterForm } from '../src/features/auth/validation';

describe('Registration form validation', () => {
  const validForm = {
    username: 'TestMobile01',
    email: 'alice@example.com',
    password: 'Password123!',
    confirmPassword: 'Password123!',
  };

  it('accepts valid registration data', () => {
    expect(validateRegisterForm(validForm)).toEqual({});
  });

  it('rejects invalid usernames', () => {
    expect(
      validateRegisterForm({
        ...validForm,
        username: 'a b',
      }).username,
    ).toBeDefined();
  });

  it('rejects short passwords', () => {
    expect(
      validateRegisterForm({
        ...validForm,
        password: 'short',
        confirmPassword: 'short',
      }).password,
    ).toBeDefined();
  });

  it.each([
    ['Password!', 'validation.passwordDigit'],
    ['password1!', 'validation.passwordUppercase'],
    ['Password1', 'validation.passwordSpecial'],
  ])('returns a specific password requirement for %s', (password, key) => {
    expect(
      validateRegisterForm({
        ...validForm,
        password,
        confirmPassword: password,
      }).password,
    ).toBe(key);
  });

  it('validates the trimmed username', () => {
    expect(
      validateRegisterForm({ ...validForm, username: '  TestMobile01  ' }),
    ).toEqual({});
  });

  it('requires a valid email', () => {
    expect(validateRegisterForm({ ...validForm, email: '' }).email).toBe(
      'validation.email',
    );
    expect(validateRegisterForm(validForm)).toEqual({});
    expect(
      validateRegisterForm({ ...validForm, email: 'alice@example.com' }),
    ).toEqual({});
    expect(
      validateRegisterForm({ ...validForm, email: 'not-an-email' }).email,
    ).toBe('validation.email');
  });

  it('rejects mismatched passwords', () => {
    expect(
      validateRegisterForm({
        ...validForm,
        confirmPassword: 'Different123!',
      }).confirmPassword,
    ).toBeDefined();
  });
});
