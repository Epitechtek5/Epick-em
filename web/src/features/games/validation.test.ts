import { ApiError } from '@/lib/api/http'
import { changedGameFields, gameId, isGameId, validateGame } from './validation'

const ok = { name: 'Zelda', description: '', images: [] }

describe('validateGame', () => {
  it('accepte un jeu valide', () => {
    expect(validateGame({ ...ok, images: ['https://a.example/x.png', 'http://b.example/y'] })).toEqual({})
  })

  it('nom : 1 à 64 caractères après trim', () => {
    expect(validateGame({ ...ok, name: '   ' }).name).toBeDefined()
    expect(validateGame({ ...ok, name: '' }).name).toBeDefined()
    expect(validateGame({ ...ok, name: ` ${'a'.repeat(64)} ` }).name).toBeUndefined()
    expect(validateGame({ ...ok, name: 'a'.repeat(65) }).name).toBeDefined()
  })

  it('compte les caractères Unicode, pas les unités UTF-16', () => {
    expect(validateGame({ ...ok, name: '🎮'.repeat(64) }).name).toBeUndefined()
    expect(validateGame({ ...ok, name: '🎮'.repeat(65) }).name).toBeDefined()
  })

  it('description : 2000 caractères maximum', () => {
    expect(validateGame({ ...ok, description: 'a'.repeat(2000) }).description).toBeUndefined()
    expect(validateGame({ ...ok, description: 'a'.repeat(2001) }).description).toBeDefined()
  })

  it('images : 10 maximum', () => {
    const url = 'https://a.example/x.png'
    expect(validateGame({ ...ok, images: Array(10).fill(url) }).images).toBeUndefined()
    expect(validateGame({ ...ok, images: Array(11).fill(url) }).images).toBeDefined()
  })

  it.each([
    ['ftp://a.example/x'],
    ['a.example/x.png'],
    ['https://a.example/x y.png'],
    ['https://'],
    [''],
    ['javascript:alert(1)'],
  ])('refuse l\'URL %s', (url) => {
    expect(validateGame({ ...ok, images: [url] }).images).toBeDefined()
  })

  it('URL : 2048 octets UTF-8 maximum', () => {
    const base = 'https://a.example/'
    expect(validateGame({ ...ok, images: [base + 'a'.repeat(2048 - base.length)] }).images).toBeUndefined()
    expect(validateGame({ ...ok, images: [base + 'a'.repeat(2049 - base.length)] }).images).toBeDefined()
    // 'é' = 2 octets : 1100 caractères dépassent 2048 octets.
    expect(validateGame({ ...ok, images: [base + 'é'.repeat(1100)] }).images).toBeDefined()
  })
})

describe('changedGameFields', () => {
  const original = { name: 'Zelda', description: 'd', images: ['https://a.example/1', 'https://a.example/2'] }

  it('ne renvoie rien sans modification', () => {
    expect(changedGameFields(original, { ...original, name: ' Zelda ' })).toEqual({})
  })

  it('ne renvoie que les champs modifiés', () => {
    expect(changedGameFields(original, { ...original, description: 'nouveau' })).toEqual({ description: 'nouveau' })
    expect(changedGameFields(original, { ...original, name: ' Mario ' })).toEqual({ name: 'Mario' })
  })

  it('détecte un réordonnancement des images', () => {
    const images = [...original.images].reverse()
    expect(changedGameFields(original, { ...original, images })).toEqual({ images })
  })
})

describe('gameId', () => {
  it('valide les UUID', () => {
    expect(isGameId('11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(isGameId('not-a-uuid')).toBe(false)
    expect(() => gameId('../etc')).toThrow(ApiError)
  })
})
