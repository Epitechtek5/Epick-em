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

const PREVIEW_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

// Aperçu d'un tournoi créé : une étape terminée, ses têtes de série et ses résultats.
const PREVIEW = {
  preview_id: PREVIEW_ID,
  expires_in: 600,
  valid: true,
  requires_confirmation: false,
  tournaments: [
    {
      game: 'Alpha Quest',
      name: 'TFT Open',
      action: 'create',
      destructive: false,
      changes: [
        { resource: 'tournament', action: 'create', before: 0, after: 1 },
        { resource: 'participants', action: 'create', before: 0, after: 4 },
      ],
      downstream: ['étape 1 (finished) : 4 participant(s).'],
      steps: [
        {
          position: 1,
          status: 'finished',
          groups: [
            {
              index: 1,
              participants: [
                { name: 'alice', seed: 1, points: 9.5, rank: 1, status: 'qualified' },
                { name: 'bob', seed: 2, points: 3, rank: 2, status: 'eliminated' },
              ],
            },
          ],
          matches: [
            {
              index: 1,
              status: 'finished',
              next: 2,
              participants: [
                { name: 'alice', points: 9.5, rank: 1, result: 'win' },
                { name: 'bob', points: 3, rank: 2, result: 'loss' },
              ],
            },
          ],
        },
      ],
    },
  ],
  warnings: ['Les points de bob sont recalculés.'],
  errors: [],
}

// Aperçu d'un tournoi existant dont les données sont remplacées.
const DESTRUCTIVE = {
  ...PREVIEW,
  requires_confirmation: true,
  tournaments: [
    {
      ...PREVIEW.tournaments[0],
      action: 'update',
      destructive: true,
      changes: [
        { resource: 'tournament', action: 'update', before: 1, after: 1, details: 'description' },
        { resource: 'participants', action: 'replace', before: 4, after: 4 },
        { resource: 'matches', action: 'delete', before: 3, after: 0 },
      ],
      downstream: ['3 résultat(s) de match terminé(s) existant(s) seront écrasés.'],
    },
  ],
}

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
  ] as const)('analyse %s, montre l’aperçu, puis n’importe que cet aperçu', async (name, content, format, mime) => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = mockFetch(jsonResponse(200, PREVIEW), jsonResponse(200, { created: 1, updated: 0 }))
    renderApp('/tournaments/transfer')

    await user.upload(screen.getByLabelText('Choisir un fichier JSON / CSV'), new File([content], name))
    const panel = await screen.findByRole('region', { name: 'Aperçu de l’import' })
    expect(within(panel).getByText(`Fichier : ${name} (${format.toUpperCase()})`)).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/tournaments/import/preview?format=${format}`)
    expect(init.headers['Content-Type']).toBe(mime)
    expect(await (init.body as Blob).text()).toBe(content)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Changements groupés par action, avec leurs effectifs.
    const tournament = within(panel).getByRole('article', { name: 'TFT Open (Alpha Quest)' })
    expect(within(tournament).getAllByText('Création').length).toBeGreaterThan(0)
    expect(within(tournament).getByText('Inscrits')).toBeInTheDocument()
    expect(within(tournament).getByText('avant : 0, après : 4')).toBeInTheDocument()
    expect(within(tournament).getByText('étape 1 (finished) : 4 participant(s).')).toBeInTheDocument()
    // Têtes de série, placements et résultats calculés par le serveur.
    await user.click(within(tournament).getByText('Étape 1 (Terminée)'))
    const group = within(tournament).getByRole('table', { name: 'Groupe 1' })
    expect(within(group).getByRole('row', { name: /alice/ })).toHaveTextContent('1alice9.51Qualifié')
    expect(within(tournament).getByText('alice : 9.5 pts, rang 1, résultat Victoire')).toBeInTheDocument()
    expect(within(tournament).getByText('vainqueur vers le match 2')).toBeInTheDocument()
    expect(within(panel).getByText('Les points de bob sont recalculés.')).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'Confirmer l’import' }))
    expect(await screen.findByText('Import terminé : 1 créés, 0 mis à jour.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voir les tournois' })).toHaveAttribute('href', '/tournaments')
    expect(screen.queryByRole('region', { name: 'Aperçu de l’import' })).not.toBeInTheDocument()
    const [applyUrl, applyInit] = fetchMock.mock.calls[1]
    expect(applyUrl).toBe('/api/tournaments/import/apply')
    expect(JSON.parse(applyInit.body as string)).toEqual({ preview_id: PREVIEW_ID, confirm_destructive: false })
  })

  it('exige le consentement pour un import destructif et ne confirme qu’une fois', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    let release: (response: Response) => void = () => {}
    const fetchMock = routeFetch((path) =>
      path.startsWith('/tournaments/import/preview')
        ? jsonResponse(200, DESTRUCTIVE)
        : new Promise<Response>((resolve) => {
            release = resolve
          }),
    )
    renderApp('/tournaments/transfer')
    await user.upload(screen.getByLabelText('Choisir un fichier JSON / CSV'), new File([JSON_EXPORT], 'tournaments.json'))
    const panel = await screen.findByRole('region', { name: 'Aperçu de l’import' })

    expect(within(panel).getByText('Opérations destructives')).toBeInTheDocument()
    expect(within(panel).getByText('Remplace des données existantes')).toBeInTheDocument()
    expect(within(panel).getByText('3 résultat(s) de match terminé(s) existant(s) seront écrasés.')).toBeInTheDocument()
    expect(within(panel).getAllByText('Remplacement').length).toBeGreaterThan(0)
    expect(within(panel).getAllByText('Suppression').length).toBeGreaterThan(0)
    expect(within(panel).getAllByText('Mise à jour').length).toBeGreaterThan(0)
    expect(within(panel).getByText('(description)')).toBeInTheDocument()
    const confirm = within(panel).getByRole('button', { name: 'Confirmer l’import' })
    expect(confirm).toBeDisabled()

    await user.click(within(panel).getByRole('checkbox', { name: /J’ai vérifié les remplacements/ }))
    expect(confirm).toBeEnabled()
    await user.dblClick(confirm)
    expect(await within(panel).findByText('Import de l’aperçu confirmé…')).toBeInTheDocument()
    release(jsonResponse(200, { created: 0, updated: 1 }))
    expect(await screen.findByText('Import terminé : 0 créés, 1 mis à jour.')).toBeInTheDocument()
    const applies = fetchMock.mock.calls.filter(([url]) => url === '/api/tournaments/import/apply')
    expect(applies).toHaveLength(1)
    expect(JSON.parse(applies[0][1].body as string)).toEqual({ preview_id: PREVIEW_ID, confirm_destructive: true })
  })

  it('n’importe rien si l’administrateur annule l’aperçu', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = mockFetch(jsonResponse(200, PREVIEW))
    renderApp('/tournaments/transfer')
    await user.upload(screen.getByLabelText('Choisir un fichier JSON / CSV'), new File([JSON_EXPORT], 'tournaments.json'))
    const panel = await screen.findByRole('region', { name: 'Aperçu de l’import' })
    await user.click(within(panel).getByRole('button', { name: 'Annuler l’import' }))
    expect(screen.queryByRole('region', { name: 'Aperçu de l’import' })).not.toBeInTheDocument()
    expect(screen.getByText('Import annulé : rien n’a été importé.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('montre les erreurs de validation et ne propose pas de confirmer un fichier invalide', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    mockFetch(
      jsonResponse(200, {
        valid: false,
        requires_confirmation: false,
        tournaments: [],
        warnings: [],
        errors: ['Tournoi 1 : game : jeu inconnu « Nope ».'],
      }),
    )
    renderApp('/tournaments/transfer')
    await user.upload(screen.getByLabelText('Choisir un fichier JSON / CSV'), new File([JSON_EXPORT], 'tournaments.json'))
    const panel = await screen.findByRole('region', { name: 'Aperçu de l’import' })
    const alert = within(panel).getByRole('alert')
    expect(alert).toHaveTextContent('Erreurs de validation : 1')
    expect(alert).toHaveTextContent('Tournoi 1 : game : jeu inconnu « Nope ».')
    expect(within(panel).queryByRole('button', { name: 'Confirmer l’import' })).not.toBeInTheDocument()
  })

  it('affiche errors.file renvoyé par le serveur pendant l’analyse', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    mockFetch(jsonResponse(400, { error: 'invalid_request', errors: { file: 'Ligne 1 : en-tête inattendu.' } }))
    renderApp('/tournaments/transfer')
    await user.upload(screen.getByLabelText('Choisir un fichier JSON / CSV'), new File([CSV_EXPORT], 'tournaments.csv'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Le serveur a refusé ce fichier')
    expect(alert).toHaveTextContent('Ligne 1 : en-tête inattendu.')
    expect(screen.queryByRole('region', { name: 'Aperçu de l’import' })).not.toBeInTheDocument()
  })

  it.each([
    [409, { error: 'import_preview_stale' }, 'Les données ont changé depuis l’aperçu'],
    [410, { error: 'import_preview_expired' }, 'Cet aperçu a expiré ou a déjà été utilisé'],
  ])('un aperçu refusé (%i) n’importe rien et se refait sur le même fichier', async (status, body, message) => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = mockFetch(jsonResponse(200, PREVIEW), jsonResponse(status, body), jsonResponse(200, PREVIEW))
    renderApp('/tournaments/transfer')
    await user.upload(screen.getByLabelText('Choisir un fichier JSON / CSV'), new File([JSON_EXPORT], 'tournaments.json'))
    let panel = await screen.findByRole('region', { name: 'Aperçu de l’import' })
    await user.click(within(panel).getByRole('button', { name: 'Confirmer l’import' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    panel = screen.getByRole('region', { name: 'Aperçu de l’import' })
    expect(within(panel).queryByRole('button', { name: 'Confirmer l’import' })).not.toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Refaire l’aperçu' }))
    expect(await screen.findByRole('button', { name: 'Confirmer l’import' })).toBeEnabled()
    const [url, init] = fetchMock.mock.calls[2]
    expect(url).toBe('/api/tournaments/import/preview?format=json')
    expect(await (init.body as Blob).text()).toBe(JSON_EXPORT)
  })

  it('ne renvoie jamais une confirmation dont l’issue est inconnue', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = mockFetch(jsonResponse(200, PREVIEW), new TypeError('Failed to fetch'))
    renderApp('/tournaments/transfer')
    await user.upload(screen.getByLabelText('Choisir un fichier JSON / CSV'), new File([JSON_EXPORT], 'tournaments.json'))
    const panel = await screen.findByRole('region', { name: 'Aperçu de l’import' })
    await user.click(within(panel).getByRole('button', { name: 'Confirmer l’import' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('l’import a peut-être eu lieu')
    expect(screen.getByRole('link', { name: 'Voir les tournois' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Aperçu de l’import' })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('signale un serveur qui ne détaille pas les placements', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const { steps: _steps, ...summary } = PREVIEW.tournaments[0]
    mockFetch(jsonResponse(200, { ...PREVIEW, tournaments: [summary] }))
    renderApp('/tournaments/transfer')
    await user.upload(screen.getByLabelText('Choisir un fichier JSON / CSV'), new File([JSON_EXPORT], 'tournaments.json'))
    expect(
      await screen.findByText('Le serveur ne détaille pas les placements ni les résultats de ce fichier.'),
    ).toBeInTheDocument()
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
