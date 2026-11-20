import { optionKey, optionLabel, optionsProblem, OPTIONS_MAX } from './options'

describe('optionKey', () => {
  it('dérive un slug sans accents du libellé', () => {
    expect(optionKey('Mirage', [])).toBe('mirage')
    expect(optionKey('  Île de Ascent ! ', [])).toBe('ile_de_ascent')
    expect(optionKey('Kai’Sa', [])).toBe('kai_sa')
    expect(optionKey('★★★', [])).toBe('option')
  })

  it('ne réutilise jamais une clé déjà attribuée', () => {
    expect(optionKey('Mirage', ['mirage'])).toBe('mirage_2')
    expect(optionKey('Mirage', ['mirage', 'mirage_2'])).toBe('mirage_3')
  })

  it('reste sous la longueur maximale d’une clé', () => {
    expect(optionKey('a'.repeat(200), []).length).toBeLessThanOrEqual(64)
  })
})

describe('optionsProblem', () => {
  it('accepte une liste valide, vide comprise', () => {
    expect(optionsProblem([])).toBeNull()
    expect(optionsProblem([{ key: 'ascent', label: 'Ascent' }, { key: 'bind', label: 'Bind' }])).toBeNull()
  })

  it('refuse les clés invalides ou en double et les libellés vides ou trop longs', () => {
    expect(optionsProblem([{ key: 'Ascent', label: 'Ascent' }])).not.toBeNull()
    expect(optionsProblem([{ key: 'a', label: 'A' }, { key: 'a', label: 'B' }])).not.toBeNull()
    expect(optionsProblem([{ key: 'a', label: '   ' }])).not.toBeNull()
    expect(optionsProblem([{ key: 'a', label: 'x'.repeat(65) }])).not.toBeNull()
  })

  it('refuse plus de 500 valeurs', () => {
    const many = Array.from({ length: OPTIONS_MAX + 1 }, (_, index) => ({ key: `v${index}`, label: `V${index}` }))
    expect(optionsProblem(many)).not.toBeNull()
    expect(optionsProblem(many.slice(0, OPTIONS_MAX))).toBeNull()
  })
})

describe('optionLabel', () => {
  it('affiche le libellé, ou la clé d’une valeur retirée', () => {
    const options = [{ key: 'ascent', label: 'Ascent' }]
    expect(optionLabel(options, 'ascent')).toBe('Ascent')
    expect(optionLabel(options, 'split')).toBe('split')
    expect(optionLabel(undefined, 'split')).toBe('split')
  })
})
