import en from '../src/i18n/locales/en.json';
import fr from '../src/i18n/locales/fr.json';
import i18n from '../src/i18n';
import { getUserErrorMessage } from '../src/features/users/errors';
import { ApiError } from '../src/lib/api';
import { validateRegisterForm } from '../src/features/auth/validation';

function leaves(value: object, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof entry === 'string'
        ? [[path, entry]]
        : Object.entries(leaves(entry, path));
    }),
  );
}
it('has complete matching English and French keys and interpolation variables', () => {
  const english = leaves(en);
  const french = leaves(fr);
  expect(Object.keys(french).sort()).toEqual(Object.keys(english).sort());
  for (const [key, value] of Object.entries(english)) {
    expect(french[key].trim()).not.toBe('');
    expect(french[key].match(/{{\w+}}/g)).toEqual(value.match(/{{\w+}}/g));
  }
});
it.each([400, 401, 403, 404, 409, 500])(
  'translates HTTP %i by status, independently of server text',
  async (status) => {
    const key = getUserErrorMessage(
      new ApiError(status, 'untrusted server text'),
    );
    await i18n.changeLanguage('fr');
    expect(i18n.t(key)).not.toBe(key);
    expect(i18n.t(key)).not.toContain('untrusted');
    await i18n.changeLanguage('en');
    expect(i18n.t(key)).not.toBe(key);
  },
);
it('keeps validation errors as translatable keys', async () => {
  const errors = validateRegisterForm({
    username: 'a',
    password: 'short',
    confirmPassword: 'different',
  });
  expect(errors).toEqual({
    username: 'validation.username',
    password: 'validation.password',
    confirmPassword: 'validation.match',
  });
  await i18n.changeLanguage('fr');
  expect(i18n.t(errors.password!)).toBe(fr.validation.password);
  await i18n.changeLanguage('en');
});
