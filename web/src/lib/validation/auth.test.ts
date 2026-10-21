import {
  validateLogin,
  validatePassword,
  validatePasswordConfirmation,
  validateRegister,
  validateUsername,
} from './auth'

describe('validateUsername', () => {
  it.each(['abc', 'John_Doe-1.x', 'a'.repeat(32)])('accepte %s', (value) => {
    expect(validateUsername(value)).toBeNull()
  })

  it('refuse vide, trop court et trop long', () => {
    expect(validateUsername('')).toMatch(/Saisissez/)
    expect(validateUsername('ab')).toMatch(/entre 3 et 32/)
    expect(validateUsername('a'.repeat(33))).toMatch(/entre 3 et 32/)
  })

  it.each(['john doe', 'jöhn', 'john@doe', 'jo/hn'])('refuse %s', (value) => {
    expect(validateUsername(value)).toMatch(/lettres, des chiffres/)
  })
})

describe('validatePassword', () => {
  it('accepte de 8 à 128 caractères', () => {
    expect(validatePassword('a'.repeat(8))).toBeNull()
    expect(validatePassword('a'.repeat(128))).toBeNull()
  })

  it('refuse vide, trop court et trop long', () => {
    expect(validatePassword('')).toMatch(/Saisissez/)
    expect(validatePassword('a'.repeat(7))).toMatch(/entre 8 et 128/)
    expect(validatePassword('a'.repeat(129))).toMatch(/entre 8 et 128/)
  })
})

describe('validatePasswordConfirmation', () => {
  it('exige une confirmation identique', () => {
    expect(validatePasswordConfirmation('secret123', 'secret123')).toBeNull()
    expect(validatePasswordConfirmation('secret123', '')).toMatch(/Confirmez/)
    expect(validatePasswordConfirmation('secret123', 'secret124')).toMatch(
      /ne correspondent pas/,
    )
  })
})

describe('validateRegister / validateLogin', () => {
  it('retourne une erreur par champ invalide', () => {
    expect(
      Object.keys(validateRegister({ username: 'a', password: 'b', confirmPassword: 'c' })),
    ).toEqual(['username', 'password', 'confirmPassword'])
    expect(
      validateRegister({ username: 'alice', password: 'secret123', confirmPassword: 'secret123' }),
    ).toEqual({})
  })

  it('ne vérifie que la présence des champs à la connexion', () => {
    expect(validateLogin({ username: '', password: '' })).toHaveProperty('username')
    expect(validateLogin({ username: 'a', password: 'x' })).toEqual({})
  })
})
