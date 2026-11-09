import { checkImportSize, downloadBlob, GameFileError, importFormat, prepareImport } from './files'
import { MAX_IMPORT_BYTES } from './validation'

const file = (content: BlobPart, name: string) => new File([content], name)

describe('importFormat', () => {
  it('reconnaît json et csv, sans tenir compte de la casse', () => {
    expect(importFormat('games.json')).toBe('json')
    expect(importFormat('GAMES.CSV')).toBe('csv')
  })
  it('refuse les autres extensions', () => {
    expect(() => importFormat('games.txt')).toThrow(GameFileError)
    expect(() => importFormat('games')).toThrow(GameFileError)
  })
})

describe('checkImportSize', () => {
  it('refuse vide et au-delà de 256 Kio', () => {
    expect(() => checkImportSize(0)).toThrow(GameFileError)
    expect(() => checkImportSize(MAX_IMPORT_BYTES + 1)).toThrow(GameFileError)
    expect(() => checkImportSize(MAX_IMPORT_BYTES)).not.toThrow()
  })
})

describe('prepareImport', () => {
  it('lit un JSON valide', async () => {
    const text = JSON.stringify({ version: 1, games: [] })
    const prepared = await prepareImport(file(text, 'games.json'))
    expect(prepared.format).toBe('json')
    expect(new TextDecoder().decode(prepared.bytes)).toBe(text)
  })

  it('lit un CSV', async () => {
    const prepared = await prepareImport(file('name,description,images,stats\n', 'g.csv'))
    expect(prepared.format).toBe('csv')
  })

  it('refuse un JSON invalide, de l\'UTF-8 invalide et un fichier trop gros', async () => {
    await expect(prepareImport(file('{nope', 'g.json'))).rejects.toMatchObject({
      key: 'games.validation.fileContent',
    })
    await expect(prepareImport(file(new Uint8Array([0xff, 0xfe, 0xfd]), 'g.csv'))).rejects.toMatchObject({
      key: 'games.validation.fileContent',
    })
    await expect(
      prepareImport(file('a'.repeat(MAX_IMPORT_BYTES + 1), 'g.csv')),
    ).rejects.toMatchObject({ key: 'games.validation.fileSize' })
    await expect(prepareImport(file('x', 'g.xml'))).rejects.toMatchObject({
      key: 'games.validation.fileFormat',
    })
  })
})

describe('downloadBlob', () => {
  it('déclenche un téléchargement avec le bon nom de fichier', () => {
    const create = vi.fn(() => 'blob:x')
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('games.csv')
      expect(this.href).toContain('blob:x')
    })

    downloadBlob(new Blob(['a']), 'games.csv')

    expect(click).toHaveBeenCalledOnce()
    click.mockRestore()
  })
})
