import { validateRegisterForm } from '../src/features/auth/validation';

describe('Registration form validation', () => {
  const validForm = {
    username: 'TestMobile01',
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

  it('rejects mismatched passwords', () => {
    expect(
      validateRegisterForm({
        ...validForm,
        confirmPassword: 'Different123!',
      }).confirmPassword,
    ).toBeDefined();
  });
});
