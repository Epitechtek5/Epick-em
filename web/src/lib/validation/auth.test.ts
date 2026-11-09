import {
  isValidEmail,
  normalizeEmail,
  serverFieldErrors,
  validateEmail,
  validateEnroll,
  validateLogin,
  validatePassword,
  validatePasswordConfirmation,
  validateRegister,
  validateReset,
  validateUsername,
} from './auth'

describe('validateUsername', () => {
  it.each(['abc', 'John_Doe-1.x', 'a'.repeat(32)])('accepte %s', (value) => {
    expect(validateUsername(value)).toBeNull()
  })

  it('refuse vide, trop court et trop long', () => {
    expect(validateUsername('')).toBe('auth.validation.usernameRequired')
    expect(validateUsername('ab')).toBe('auth.validation.usernameLength')
    expect(validateUsername('a'.repeat(33))).toBe('auth.validation.usernameLength')
  })

  it.each(['john doe', 'jöhn', 'john@doe', 'jo/hn'])('refuse %s', (value) => {
    expect(validateUsername(value)).toBe('auth.validation.usernameFormat')
  })
})

describe('validateEmail (miroir de email_error côté serveur)', () => {
  it.each(['alice@example.com', '  Alice@Example.COM ', 'a.b+c@sub.domain.fr', 'x@y.z'])(
    'accepte %j',
    (value) => {
      expect(validateEmail(value)).toBeNull()
    },
  )

  it.each([
    'alice',
    '@example.com',
    'alice@',
    'alice@example',
    'alice@example.',
    'alice@.com',
    'alice@@example.com',
    'a@b@example.com',
    'ali ce@example.com',
    'alice@exa\tmple.com',
    `${'a'.repeat(250)}@b.fr`,
  ])('refuse %j', (value) => {
    expect(validateEmail(value)).toBe('auth.validation.emailInvalid')
  })

  it('exige une adresse', () => {
    expect(validateEmail('')).toBe('auth.validation.emailRequired')
    expect(validateEmail('   ')).toBe('auth.validation.emailRequired')
  })

  it('compare la forme normalisée (trim, minuscules) comme le serveur', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com')
    expect(isValidEmail('  Alice@Example.COM ')).toBe(true)
  })
})

describe('validatePassword', () => {
  it('accepte de 8 à 128 caractères', () => {
    expect(validatePassword('a'.repeat(8))).toBeNull()
    expect(validatePassword('a'.repeat(128))).toBeNull()
  })

  it('compte les caractères Unicode, pas les unités UTF-16', () => {
    expect(validatePassword('😀'.repeat(8))).toBeNull()
    expect(validatePassword('😀'.repeat(7))).toBe('auth.validation.passwordLength')
  })

  it('refuse vide, trop court et trop long', () => {
    expect(validatePassword('')).toBe('auth.validation.passwordRequired')
    expect(validatePassword('a'.repeat(7))).toBe('auth.validation.passwordLength')
    expect(validatePassword('a'.repeat(129))).toBe('auth.validation.passwordLength')
  })
})

describe('validatePasswordConfirmation', () => {
  it('exige une confirmation identique', () => {
    expect(validatePasswordConfirmation('secret123', 'secret123')).toBeNull()
    expect(validatePasswordConfirmation('secret123', '')).toBe('auth.validation.confirmRequired')
    expect(validatePasswordConfirmation('secret123', 'secret124')).toBe(
      'auth.validation.confirmMismatch',
    )
  })
})

describe('validateurs de formulaire', () => {
  it('inscription : une erreur par champ invalide', () => {
    expect(
      Object.keys(
        validateRegister({ username: 'a', email: 'x', password: 'b', confirmPassword: 'c' }),
      ),
    ).toEqual(['username', 'email', 'password', 'confirmPassword'])
    expect(
      validateRegister({
        username: 'alice',
        email: 'alice@example.com',
        password: 'secret123',
        confirmPassword: 'secret123',
      }),
    ).toEqual({})
  })

  it('connexion : adresse valide et mot de passe présent', () => {
    expect(validateLogin({ email: '', password: '' })).toEqual({
      email: 'auth.validation.emailRequired',
      password: 'auth.validation.passwordRequired',
    })
    // Pas de règle de longueur à la connexion.
    expect(validateLogin({ email: 'a@b.fr', password: 'x' })).toEqual({})
  })

  it('réinitialisation : mêmes règles qu’à l’inscription', () => {
    expect(validateReset({ password: 'court', confirmPassword: 'autre' })).toEqual({
      password: 'auth.validation.passwordLength',
      confirmPassword: 'auth.validation.confirmMismatch',
    })
    expect(validateReset({ password: 'secret123', confirmPassword: 'secret123' })).toEqual({})
  })

  it('ajout d’adresse : identifiants requis, adresse valide', () => {
    expect(validateEnroll({ username: '', password: '', email: 'x' })).toEqual({
      username: 'auth.validation.usernameRequired',
      password: 'auth.validation.passwordRequired',
      email: 'auth.validation.emailInvalid',
    })
  })
})

describe('serverFieldErrors', () => {
  it('traduit les erreurs du serveur avec la règle locale, sinon un message générique', () => {
    expect(
      serverFieldErrors(
        { email: 'Saisissez une adresse e-mail valide.', username: 'refusé', other: 'x' },
        (field) => (field === 'username' ? null : 'auth.validation.emailInvalid'),
        ['username', 'email', 'password'] as const,
      ),
    ).toEqual({
      username: 'auth.validation.usernameRejected',
      email: 'auth.validation.emailInvalid',
    })
  })
})
