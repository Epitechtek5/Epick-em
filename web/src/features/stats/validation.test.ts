import { ApiError } from '@/lib/api/http'
import { changedStatFields, isValidKey, statId, validateStat } from './validation'

const ok = { name: 'Éliminations', key: 'kills', type: 'flat' as const }

describe('validateStat', () => {
  it('accepte une statistique valide', () => {
    expect(validateStat(ok)).toEqual({})
    expect(validateStat({ ...ok, key: 'headshot_ratio_2', type: 'percent' })).toEqual({})
  })

  it('nom : 1 à 64 caractères après trim', () => {
    expect(validateStat({ ...ok, name: '   ' }).name).toBeDefined()
    expect(validateStat({ ...ok, name: ` ${'a'.repeat(64)} ` }).name).toBeUndefined()
    expect(validateStat({ ...ok, name: 'a'.repeat(65) }).name).toBeDefined()
    expect(validateStat({ ...ok, name: '🎮'.repeat(64) }).name).toBeUndefined()
    expect(validateStat({ ...ok, name: '🎮'.repeat(65) }).name).toBeDefined()
  })

  it.each(['kills', 'k', 'a1_b2', 'ab_cd_ef', '123'])('accepte la clé %s', (key) => {
    expect(isValidKey(key)).toBe(true)
  })

  it.each(['', 'Kills', 'kills ', 'kill-s', '_kills', 'kills_', 'ki__lls', 'élim', 'a b'])(
    'refuse la clé %j',
    (key) => {
      expect(isValidKey(key)).toBe(false)
    },
  )

  it('clé : 64 caractères maximum, espaces autour ignorés', () => {
    expect(validateStat({ ...ok, key: 'a'.repeat(64) }).key).toBeUndefined()
    expect(validateStat({ ...ok, key: 'a'.repeat(65) }).key).toBeDefined()
    expect(validateStat({ ...ok, key: '  kills  ' }).key).toBeUndefined()
  })

  it('type : flat ou percent uniquement', () => {
    expect(validateStat({ ...ok, type: 'ratio' as never }).type).toBeDefined()
  })
})

describe('changedStatFields', () => {
  it('ne renvoie rien sans modification (espaces ignorés)', () => {
    expect(changedStatFields(ok, { ...ok, name: ' Éliminations ' })).toEqual({})
  })

  it('ne renvoie que les champs modifiés', () => {
    expect(changedStatFields(ok, { ...ok, type: 'percent' })).toEqual({ type: 'percent' })
    expect(changedStatFields(ok, { ...ok, key: ' frags ', name: 'Frags' })).toEqual({
      key: 'frags',
      name: 'Frags',
    })
  })
})

describe('statId', () => {
  it('valide les UUID et rejette le reste en 404', () => {
    expect(statId('55555555-5555-4555-8555-555555555555')).toBeDefined()
    expect(() => statId('kills')).toThrow(ApiError)
  })
})
