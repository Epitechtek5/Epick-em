import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { makeJwt } from '@/test/jwt'
import { jsonResponse, mockFetch, renderApp, routeFetch, signInAs } from '@/test/render'

const JSON_EXPORT = JSON.stringify({
  version: 1,
  tournaments: [
    {
      game: 'Alpha Quest',
      name: 'TFT Open',
      description: null,
      start_date: '2026-11-14T18:00:00Z',
      end_date: '2026-11-15T22:00:00Z',
      registration_open_at: null,
      registration_close_at: null,
      participant_type: 'solo',
      team_size: null,
      max_participants: 32,
      team_scoring_mode: 'none',
      team_scoring_n: null,
      status: 'draft',
      scoring_rules: [{ stat: 'kills', mode: 'linear', coefficient: 2, points_table: null }],
      participants: [{ user: 'alice', team: null, status: 'registered', registered_at: '2026-11-01T10:00:00Z' }],
      teams: [],
      steps: [],
      matches: [],
    },
  ],
})
const CSV_EXPORT =
  'game,name,description,start_date,end_date,registration_open_at,registration_close_at,participant_type,team_size,max_participants,team_scoring_mode,team_scoring_n,status,scoring_rules,participants,teams,steps,matches\r\n' +
  'Alpha Quest,TFT Open,,2026-11-14T18:00:00Z,2026-11-15T22:00:00Z,,,solo,,32,none,,draft,[],[],[],[],[]\r\n'

function stubDownload() {
  const create = vi.fn(() => 'blob:x')
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() })
  const names: string[] = []
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download)
  })
  return { names, create, restore: () => click.mockRestore() }
}

describe('TournamentTransferPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('est refusée aux non-administrateurs', () => {
    signInAs('user')
    mockFetch()
    renderApp('/tournaments/transfer')
    expect(screen.getByRole('heading', { level: 1, name: 'Accès réservé aux administrateurs' })).toBeInTheDocument()
  })

  it('avertit clairement du remplacement avant tout import', () => {
    signInAs('admin')
    mockFetch()
    renderApp('/tournaments/transfer')
    expect(
      screen.getByText(/son barème, ses inscrits, ses équipes, ses étapes et ses matchs sont remplacés/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Un tournoi en cours ou terminé est refusé/)).toBeInTheDocument()
  })

  it.each([
    ['json', 'Exporter en JSON', JSON_EXPORT, 'application/json'],
    ['csv', 'Exporter en CSV', CSV_EXPORT, 'text/csv'],
  ] as const)('exporte le vrai fichier tournaments.%s', async (format, label, content, mime) => {
    signInAs('admin')
    const user = userEvent.setup()
    const download = stubDownload()
    const fetchMock = mockFetch(
      new Response(content, {
        status: 200,
        headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="tournaments.${format}"` },
      }),
    )
    renderApp('/tournaments/transfer')
    await user.click(screen.getByRole('button', { name: label }))
    expect(await screen.findByText(`Le fichier tournaments.${format} a été téléchargé.`)).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/tournaments/export?format=${format}`)
    expect(download.names).toEqual([`tournaments.${format}`])
    const blob = (download.create.mock.calls[0] as unknown as [Blob])[0]
    expect(await blob.text()).toBe(content)
    download.restore()
  })

  it.each([
    ['tournaments.json', JSON_EXPORT, 'json', 'application/json'],
    ['tournaments.csv', CSV_EXPORT, 'csv', 'text/csv'],
  ] as const)('importe %s seulement après confirmation explicite', async (name, content, format, mime) => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = mockFetch(jsonResponse(200, { created: 1, updated: 2 }))
    renderApp('/tournaments/transfer')

    await user.upload(screen.getByLabelText('Choisir un fichier JSON / CSV'), new File([content], name))
    const dialog = await screen.findByRole('alertdialog', { name: 'Importer ce fichier ?' })
    expect(within(dialog).getByText(name)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Importer et remplacer' }))

    expect(await screen.findByText('Import terminé : 1 créés, 2 mis à jour.')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/tournaments/import?format=${format}`)
    expect(init.headers['Content-Type']).toBe(mime)
    expect(await (init.body as Blob).text()).toBe(content)
  })

  it('n\'importe rien si l\'administrateur annule', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = mockFetch()
    renderApp('/tournaments/transfer')
    await user.upload(screen.getByLabelText('Choisir un fichier JSON / CSV'), new File([JSON_EXPORT], 'tournaments.json'))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('affiche errors.file renvoyé par le serveur (tournoi en cours refusé…)', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    mockFetch(
      jsonResponse(400, {
        error: 'invalid_request',
        errors: { file: 'Tournoi n° 1 : le tournoi « TFT Open » est en cours ou terminé.' },
      }),
    )
    renderApp('/tournaments/transfer')
    await user.upload(screen.getByLabelText('Choisir un fichier JSON / CSV'), new File([CSV_EXPORT], 'tournaments.csv'))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Importer et remplacer' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Le serveur a refusé ce fichier')
    expect(alert).toHaveTextContent('Tournoi n° 1 : le tournoi « TFT Open » est en cours ou terminé.')
  })

  it('refuse localement un JSON invalide, une mauvaise extension ou un fichier trop gros', async () => {
    signInAs('admin')
    const user = userEvent.setup({ applyAccept: false })
    const fetchMock = mockFetch()
    renderApp('/tournaments/transfer')
    const input = screen.getByLabelText('Choisir un fichier JSON / CSV')

    await user.upload(input, new File(['{nope'], 'tournaments.json'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/contenu|valide/i)
    await user.upload(input, new File(['x'], 'tournaments.txt'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choisissez un fichier .json ou .csv.')
    await user.upload(input, new File(['a'.repeat(256 * 1024 + 1)], 'tournaments.csv'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/256 Kio/)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
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
    renderApp('/tournaments/transfer')
    await user.click(screen.getByRole('button', { name: 'Exporter en CSV' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Vous n’avez pas les droits')
  })
})
