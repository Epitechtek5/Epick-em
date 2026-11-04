import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { jsonResponse, renderApp, routeFetch, signInAs, STAT_A } from '@/test/render'

describe('contrôle d\'accès', () => {
  it.each(['/stats/new', '/stats/transfer', `/stats/${STAT_A.id}/edit`])(
    'refuse %s à un non-admin sans appel réseau',
    async (route) => {
      signInAs('watcher')
      const fetchMock = routeFetch(() => jsonResponse(200, {}))
      renderApp(route)
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Accès réservé aux administrateurs' }),
      ).toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('redirige vers la connexion sans session', async () => {
    renderApp('/stats/new')
    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument()
  })
})

describe('création', () => {
  it('affiche les erreurs de validation liées aux champs, sans appel réseau', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = routeFetch(() => jsonResponse(200, {}))
    renderApp('/stats/new')

    await user.type(await screen.findByLabelText('Clé'), 'Mauvaise Clé')
    await user.click(screen.getByRole('button', { name: 'Créer une statistique' }))

    const summary = await screen.findByRole('alert')
    expect(summary).toHaveTextContent('Corrigez les erreurs suivantes')
    expect(summary).toHaveTextContent('Saisissez un nom de 1 à 64 caractères')
    expect(summary).toHaveTextContent('Saisissez une clé de 64 caractères maximum')
    expect(screen.getByLabelText('Nom')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Clé')).toHaveAttribute('aria-invalid', 'true')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('crée la statistique via POST /stats et revient au catalogue', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = routeFetch((_path, init) =>
      init.method === 'POST' ? jsonResponse(201, STAT_A) : jsonResponse(200, [STAT_A]),
    )
    renderApp('/stats/new')

    await user.type(await screen.findByLabelText('Nom'), '  Éliminations  ')
    await user.type(screen.getByLabelText('Clé'), 'kills')
    await user.selectOptions(screen.getByLabelText('Type'), 'percent')
    await user.click(screen.getByRole('button', { name: 'Créer une statistique' }))

    expect(await screen.findByText('La statistique Éliminations a été créée.')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(post[1].body as string)).toEqual({ name: 'Éliminations', key: 'kills', type: 'percent' })
  })

  it('signale une clé déjà prise (409 stat_key_taken) sur le champ clé', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    routeFetch(() => jsonResponse(409, { error: 'stat_key_taken', message: 'taken' }))
    renderApp('/stats/new')

    await user.type(await screen.findByLabelText('Nom'), 'Éliminations')
    await user.type(screen.getByLabelText('Clé'), 'kills')
    await user.click(screen.getByRole('button', { name: 'Créer une statistique' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Une statistique utilise déjà cette clé.')
    expect(screen.getByLabelText('Clé')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Clé')).toHaveValue('kills')
  })

  it('affiche un 400 générique du serveur', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    routeFetch(() => jsonResponse(400, { error: 'invalid_request' }))
    renderApp('/stats/new')

    await user.type(await screen.findByLabelText('Nom'), 'Éliminations')
    await user.type(screen.getByLabelText('Clé'), 'kills')
    await user.click(screen.getByRole('button', { name: 'Créer une statistique' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Le serveur a refusé ces données')
  })
})

describe('modification', () => {
  it('préremplit le formulaire et n\'envoie que les champs modifiés (PATCH)', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = routeFetch((_path, init) =>
      init.method === 'PATCH' ? jsonResponse(200, { ...STAT_A, type: 'percent' }) : jsonResponse(200, STAT_A),
    )
    renderApp(`/stats/${STAT_A.id}/edit`)

    expect(await screen.findByLabelText('Nom')).toHaveValue('Éliminations')
    expect(screen.getByLabelText('Clé')).toHaveValue('kills')
    expect(screen.getByLabelText('Type')).toHaveValue('flat')

    await user.selectOptions(screen.getByLabelText('Type'), 'percent')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByText('La statistique Éliminations a été mise à jour.')).toBeInTheDocument()
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(patch[0]).toBe(`/api/stats/${STAT_A.id}`)
    expect(JSON.parse(patch[1].body as string)).toEqual({ type: 'percent' })
  })

  it('n\'appelle pas le serveur quand rien n\'a changé', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = routeFetch(() => jsonResponse(200, STAT_A))
    renderApp(`/stats/${STAT_A.id}/edit`)
    await screen.findByLabelText('Nom')

    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByText('Aucune modification à enregistrer.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  })

  it('signale une clé déjà prise lors d\'une modification', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    routeFetch((_path, init) =>
      init.method === 'PATCH' ? jsonResponse(409, { error: 'stat_key_taken' }) : jsonResponse(200, STAT_A),
    )
    renderApp(`/stats/${STAT_A.id}/edit`)

    const key = await screen.findByLabelText('Clé')
    await user.clear(key)
    await user.type(key, 'accuracy')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Une statistique utilise déjà cette clé.')
  })

  it('affiche le 404 d\'une statistique supprimée entre-temps et refuse un identifiant invalide', async () => {
    signInAs('admin')
    const fetchMock = routeFetch(() => jsonResponse(404, { error: 'not_found' }))
    const view = renderApp(`/stats/${STAT_A.id}/edit`)
    expect(await screen.findByRole('alert')).toHaveTextContent('Cette statistique ou cette association est introuvable.')
    view.unmount()

    fetchMock.mockClear()
    renderApp('/stats/pas-un-uuid/edit')
    expect(await screen.findByRole('alert')).toHaveTextContent('identifiant de statistique n’est pas valide')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
