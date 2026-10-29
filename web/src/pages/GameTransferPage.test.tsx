import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { makeJwt } from '@/test/jwt'
import { jsonResponse, renderApp, routeFetch, signInAs } from '@/test/render'

const JSON_FILE = JSON.stringify({ version: 1, games: [{ name: 'Zelda', description: '', images: [], stats: [] }] })
const CSV_FILE = 'name,description,images,stats\r\nZelda,,,[]\r\n'

function mockDownloads() {
  const create = vi.fn(() => 'blob:game')
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() })
  const names: string[] = []
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download)
    })
  return { names, create, restore: () => click.mockRestore() }
}

describe('export', () => {
  it.each([
    ['json', 'Exporter en JSON', 'application/json', JSON_FILE],
    ['csv', 'Exporter en CSV', 'text/csv', CSV_FILE],
  ] as const)('télécharge le fichier %s renvoyé par le serveur', async (format, label, mime, body) => {
    signInAs('admin')
    const user = userEvent.setup()
    const downloads = mockDownloads()
    const fetchMock = routeFetch(
      () =>
        new Response(body, {
          status: 200,
          headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="games.${format}"` },
        }),
    )
    renderApp('/games/transfer')

    await user.click(await screen.findByRole('button', { name: label }))

    expect(await screen.findByText(`Le fichier games.${format} a été téléchargé.`)).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/games/export?format=${format}`)
    expect(downloads.names).toEqual([`games.${format}`])
    const blob = (downloads.create.mock.calls[0] as unknown as [Blob])[0]
    expect(await blob.text()).toBe(body)
    downloads.restore()
  })

  it('affiche l\'erreur du serveur (403)', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    routeFetch((path) =>
      path === '/refresh'
        ? jsonResponse(200, { access_token: makeJwt('admin'), refresh_token: 'r2' })
        : jsonResponse(403, { error: 'forbidden' }),
    )
    renderApp('/games/transfer')
    await user.click(await screen.findByRole('button', { name: 'Exporter en JSON' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Vous n’avez pas les droits')
  })
})

describe('import', () => {
  it.each([
    ['json', 'games.json', JSON_FILE, 'application/json'],
    ['csv', 'games.csv', CSV_FILE, 'text/csv'],
  ] as const)('importe un fichier %s en corps brut et affiche created/updated', async (format, name, body, mime) => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = routeFetch(() => jsonResponse(200, { created: 3, updated: 2 }))
    renderApp('/games/transfer')

    await user.upload(await screen.findByLabelText('Choisir un fichier JSON / CSV'), new File([body], name))

    expect(await screen.findByText('Import terminé : 3 créés, 2 mis à jour.')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/games/import?format=${format}`)
    expect(init.headers['Content-Type']).toBe(mime)
    expect(await (init.body as Blob).text()).toBe(body)
  })

  it('refuse localement une extension non supportée, un fichier trop gros et un JSON invalide', async () => {
    signInAs('admin')
    const user = userEvent.setup({ applyAccept: false })
    const fetchMock = routeFetch(() => jsonResponse(200, { created: 0, updated: 0 }))
    renderApp('/games/transfer')
    const input = await screen.findByLabelText('Choisir un fichier JSON / CSV')

    await user.upload(input, new File(['x'], 'games.txt'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choisissez un fichier .json ou .csv.')

    await user.upload(input, new File(['a'.repeat(256 * 1024 + 1)], 'big.csv'))
    expect(await screen.findByRole('alert')).toHaveTextContent('256 Kio maximum')

    await user.upload(input, new File(['{nope'], 'bad.json'))
    expect(await screen.findByRole('alert')).toHaveTextContent('JSON valide')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('affiche errors.file renvoyé par le serveur (400)', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    routeFetch(() =>
      jsonResponse(400, {
        error: 'invalid_request',
        message: 'invalid request',
        errors: { file: 'games[0].stats must be empty' },
      }),
    )
    renderApp('/games/transfer')

    await user.upload(await screen.findByLabelText('Choisir un fichier JSON / CSV'), new File([JSON_FILE], 'games.json'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Le serveur a refusé ce fichier')
    expect(alert).toHaveTextContent('games[0].stats must be empty')
  })

  it.each([
    [413, 'dépasse la limite de 256 Kio'],
    [403, 'Vous n’avez pas les droits'],
  ])('gère le statut %i du serveur', async (status, text) => {
    signInAs('admin')
    const user = userEvent.setup()
    routeFetch((path) =>
      path === '/refresh'
        ? jsonResponse(200, { access_token: makeJwt('admin'), refresh_token: 'r2' })
        : jsonResponse(status, {}),
    )
    renderApp('/games/transfer')

    await user.upload(await screen.findByLabelText('Choisir un fichier JSON / CSV'), new File([CSV_FILE], 'games.csv'))

    expect(await screen.findByRole('alert')).toHaveTextContent(text)
  })

  it('le catalogue affiche les jeux importés après actualisation', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    let imported = false
    routeFetch((_path, init) => {
      if (init.method === 'POST') {
        imported = true
        return jsonResponse(200, { created: 1, updated: 0 })
      }
      return jsonResponse(200, imported ? [{ id: '44444444-4444-4444-8444-444444444444', name: 'Zelda', description: '', images: [] }] : [])
    })
    renderApp('/games/transfer')
    await user.upload(await screen.findByLabelText('Choisir un fichier JSON / CSV'), new File([JSON_FILE], 'games.json'))
    await screen.findByText(/Import terminé/)

    await user.click(screen.getByRole('link', { name: 'Retour au catalogue' }))

    expect(await screen.findByRole('heading', { level: 2, name: 'Zelda' })).toBeInTheDocument()
  })
})
