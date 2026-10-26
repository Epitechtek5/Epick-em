import { validateUserForm } from '../src/features/users/validation';

const base = {
  username: 'Player1',
  password: '',
  confirmPassword: '',
  role: 'user' as const,
};

describe('User form validation', () => {
  it('accepts an unchanged account', () => {
    expect(validateUserForm(base, 'Player1')).toEqual({});
  });

  it('accepts a valid username', () => {
    expect(
      validateUserForm({ ...base, username: 'Player_2' }, 'Player1'),
    ).toEqual({});
  });

  it('rejects invalid usernames', () => {
    expect(
      validateUserForm({ ...base, username: 'ab' }, 'Player1').username,
    ).toBeDefined();
  });

  it('allows an unchanged password', () => {
    expect(validateUserForm(base, 'Player1').password).toBeUndefined();
  });

  it('rejects short passwords', () => {
    expect(
      validateUserForm(
        { ...base, password: '1234', confirmPassword: '1234' },
        'Player1',
      ).password,
    ).toBeDefined();
  });

  it('rejects mismatched passwords', () => {
    expect(
      validateUserForm(
        {
          ...base,
          password: 'securepassword123',
          confirmPassword: 'differentpassword',
        },
        'Player1',
      ).confirmPassword,
    ).toBeDefined();
  });

  it('accepts a valid password change', () => {
    expect(
      validateUserForm(
        {
          ...base,
          password: 'securepassword123',
          confirmPassword: 'securepassword123',
        },
        'Player1',
      ),
    ).toEqual({});
  });
});
