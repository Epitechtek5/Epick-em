import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { makeJwt } from '@/test/jwt'
import { jsonResponse, mockFetch, renderApp, routeFetch, signInAs } from '@/test/render'

const JSON_EXPORT = JSON.stringify({
  version: 1,
  teams: [
    {
      game: 'Alpha Quest',
      name: 'Karmine Corp',
      tag: 'KC',
      picture_url: null,
      owner: 'alice',
      members: [
        { username: 'alice', role: 'owner', joined_at: '2026-01-01T00:00:00Z', left_at: null },
        { username: 'carol', role: 'substitute', joined_at: '2025-01-01T00:00:00Z', left_at: '2025-06-01T00:00:00Z' },
      ],
    },
  ],
})
const CSV_EXPORT =
  'game,name,tag,picture_url,owner,members\r\nAlpha Quest,Karmine Corp,KC,,alice,"[{""username"":""alice"",""role"":""owner""}]"\r\n'

function stubDownload() {
  const create = vi.fn(() => 'blob:x')
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() })
  const names: string[] = []
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download)
  })
  return { names, create, restore: () => click.mockRestore() }
}

describe('TeamTransferPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('est refusée aux non-administrateurs', () => {
    signInAs('user')
    mockFetch()
    renderApp('/teams/transfer')
    expect(screen.getByRole('heading', { level: 1, name: 'Accès réservé aux administrateurs' })).toBeInTheDocument()
  })

  it.each([
    ['json', 'Exporter en JSON', JSON_EXPORT, 'application/json'],
    ['csv', 'Exporter en CSV', CSV_EXPORT, 'text/csv'],
  ] as const)('exporte le vrai fichier teams.%s (membres et historique compris)', async (format, label, content, mime) => {
    signInAs('admin')
    const user = userEvent.setup()
    const download = stubDownload()
    const fetchMock = mockFetch(
      new Response(content, {
        status: 200,
        headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="teams.${format}"` },
      }),
    )
    renderApp('/teams/transfer')

    await user.click(screen.getByRole('button', { name: label }))

    expect(await screen.findByText(`Le fichier teams.${format} a été téléchargé.`)).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/teams/export?format=${format}`)
    expect(download.names).toEqual([`teams.${format}`])
    const blob = (download.create.mock.calls[0] as unknown as [Blob])[0]
    expect(await blob.text()).toBe(content)
    download.restore()
  })

  it.each([
    ['teams.json', JSON_EXPORT, 'json', 'application/json'],
    ['teams.csv', CSV_EXPORT, 'csv', 'text/csv'],
  ] as const)('importe %s tel quel et affiche { created, updated }', async (name, content, format, mime) => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = mockFetch(jsonResponse(200, { created: 1, updated: 3 }))
    renderApp('/teams/transfer')

    await user.upload(screen.getByLabelText('Choisir un fichier JSON / CSV'), new File([content], name))

    expect(await screen.findByText('Import terminé : 1 créées, 3 mises à jour.')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/teams/import?format=${format}`)
    expect(init.headers['Content-Type']).toBe(mime)
    expect(await (init.body as Blob).text()).toBe(content)
  })

  it('affiche errors.file renvoyé par le serveur', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    mockFetch(
      jsonResponse(400, {
        error: 'invalid_request',
        errors: { file: 'Équipe n° 1 : compte « zoe » introuvable.' },
      }),
    )
    renderApp('/teams/transfer')
    await user.upload(screen.getByLabelText('Choisir un fichier JSON / CSV'), new File([JSON_EXPORT], 'teams.json'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Le serveur a refusé ce fichier')
    expect(alert).toHaveTextContent('Équipe n° 1 : compte « zoe » introuvable.')
  })

  it('refuse localement un JSON invalide, une mauvaise extension ou un fichier trop gros', async () => {
    signInAs('admin')
    const user = userEvent.setup({ applyAccept: false })
    const fetchMock = mockFetch()
    renderApp('/teams/transfer')
    const input = screen.getByLabelText('Choisir un fichier JSON / CSV')

    await user.upload(input, new File(['{nope'], 'teams.json'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/contenu|valide/i)

    await user.upload(input, new File(['x'], 'teams.txt'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choisissez un fichier .json ou .csv.')

    await user.upload(input, new File(['a'.repeat(256 * 1024 + 1)], 'teams.csv'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/256 Kio/)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('traite un 403 renvoyé par le serveur', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    routeFetch((path) =>
      path === '/refresh'
        ? jsonResponse(200, { access_token: makeJwt('admin'), refresh_token: 'r2' })
        : jsonResponse(403, { error: 'forbidden' }),
    )
    renderApp('/teams/transfer')
    await user.click(screen.getByRole('button', { name: 'Exporter en JSON' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Vous n’avez pas les droits')
  })
})
