import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { makeJwt } from '@/test/jwt'
import { GAME_A, jsonResponse, renderApp, routeFetch, signInAs } from '@/test/render'

const NEW_ID = '33333333-3333-4333-8333-333333333333'

describe('contrôle d\'accès', () => {
  it.each(['/games/new', '/games/transfer', `/games/${GAME_A.id}/edit`])(
    'refuse %s à un non-admin sans appel réseau',
    async (route) => {
      signInAs('user')
      const fetchMock = routeFetch(() => jsonResponse(200, {}))
      renderApp(route)
      expect(await screen.findByRole('heading', { level: 1, name: 'Accès réservé aux administrateurs' })).toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('redirige vers la connexion sans session', async () => {
    renderApp('/games/new')
    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument()
  })
})

describe('création', () => {
  it('affiche les erreurs de validation liées aux champs, sans appel réseau', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = routeFetch(() => jsonResponse(200, {}))
    renderApp('/games/new')

    await user.type(await screen.findByLabelText('Nom'), '   ')
    await user.click(screen.getByRole('button', { name: 'Créer un jeu' }))

    const summary = await screen.findByRole('alert')
    expect(summary).toHaveTextContent('Corrigez les erreurs suivantes :')
    expect(summary).toHaveTextContent('Saisissez un nom de 1 à 64 caractères')
    expect(screen.getByLabelText('Nom')).toHaveAttribute('aria-invalid', 'true')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('valide les URL d\'images comme le serveur', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = routeFetch(() => jsonResponse(200, {}))
    renderApp('/games/new')

    await user.type(await screen.findByLabelText('Nom'), 'Zelda')
    await user.click(screen.getByRole('button', { name: 'Ajouter une image' }))
    await user.type(screen.getByLabelText('Image 1'), 'ftp://x.example/a.png')
    await user.click(screen.getByRole('button', { name: 'Créer un jeu' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('jusqu’à 10 URL HTTP(S)'.replace('jusqu’à', 'Utilisez jusqu’à'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('crée le jeu via POST /games et ouvre sa fiche', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const created = { id: NEW_ID, name: 'Zelda', description: 'Hyrule', images: ['https://img.example/z.png'] }
    const fetchMock = routeFetch((path, init) => {
      if (init.method === 'POST' && path === '/games') return jsonResponse(201, created)
      return jsonResponse(200, created)
    })
    renderApp('/games/new')

    await user.type(await screen.findByLabelText('Nom'), '  Zelda  ')
    await user.type(screen.getByLabelText('Description'), 'Hyrule')
    await user.click(screen.getByRole('button', { name: 'Ajouter une image' }))
    await user.type(screen.getByLabelText('Image 1'), 'https://img.example/z.png')
    await user.click(screen.getByRole('button', { name: 'Créer un jeu' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Zelda' })).toBeInTheDocument()
    expect(screen.getByText('Le jeu Zelda a été créé.')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(post[1].body as string)).toEqual({
      name: 'Zelda',
      description: 'Hyrule',
      images: ['https://img.example/z.png'],
    })
  })

  it('signale un nom déjà pris (409 game_name_taken) sur le champ nom', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    routeFetch(() => jsonResponse(409, { error: 'game_name_taken', message: 'taken' }))
    renderApp('/games/new')

    await user.type(await screen.findByLabelText('Nom'), 'alpha quest')
    await user.click(screen.getByRole('button', { name: 'Créer un jeu' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Un jeu porte déjà ce nom.')
    expect(screen.getByLabelText('Nom')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Nom')).toHaveValue('alpha quest')
  })

  it('affiche une erreur 403 du serveur malgré l\'interface admin', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    routeFetch((path) =>
      path === '/refresh'
        ? jsonResponse(200, { access_token: makeJwt('admin'), refresh_token: 'r2' })
        : jsonResponse(403, { error: 'forbidden' }),
    )
    renderApp('/games/new')

    await user.type(await screen.findByLabelText('Nom'), 'Zelda')
    await user.click(screen.getByRole('button', { name: 'Créer un jeu' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Vous n’avez pas les droits nécessaires')
  })

  it('retire l\'écran d\'administration quand le rôle relu n\'est plus admin', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    routeFetch((path) =>
      path === '/refresh'
        ? jsonResponse(200, { access_token: makeJwt('user'), refresh_token: 'r2' })
        : jsonResponse(403, { error: 'forbidden' }),
    )
    renderApp('/games/new')

    await user.type(await screen.findByLabelText('Nom'), 'Zelda')
    await user.click(screen.getByRole('button', { name: 'Créer un jeu' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Accès réservé aux administrateurs' })).toBeInTheDocument()
  })

  it('gère l\'ajout, la suppression et le réordonnancement des images (10 maximum)', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    routeFetch(() => jsonResponse(200, {}))
    renderApp('/games/new')
    await screen.findByLabelText('Nom')

    for (let i = 0; i < 10; i++) await user.click(screen.getByRole('button', { name: 'Ajouter une image' }))
    expect(screen.getByRole('button', { name: 'Ajouter une image' })).toBeDisabled()

    await user.type(screen.getByLabelText('Image 1'), 'https://a.example/1')
    await user.type(screen.getByLabelText('Image 2'), 'https://a.example/2')
    await user.click(screen.getByRole('button', { name: 'Descendre l’image 1' }))
    expect(screen.getByLabelText('Image 1')).toHaveValue('https://a.example/2')
    expect(screen.getByLabelText('Image 2')).toHaveValue('https://a.example/1')

    await user.click(screen.getByRole('button', { name: 'Retirer l’image 1' }))
    expect(screen.getByLabelText('Image 1')).toHaveValue('https://a.example/1')
    expect(screen.queryByLabelText('Image 10')).not.toBeInTheDocument()
  })
})

describe('modification', () => {
  it('préremplit le formulaire et n\'envoie que les champs modifiés (PATCH)', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const updated = { ...GAME_A, description: 'Nouvelle description' }
    const fetchMock = routeFetch((_path, init) =>
      init.method === 'PATCH' ? jsonResponse(200, updated) : jsonResponse(200, GAME_A),
    )
    renderApp(`/games/${GAME_A.id}/edit`)

    const name = await screen.findByLabelText('Nom')
    expect(name).toHaveValue('Alpha Quest')
    expect(screen.getByLabelText('Image 2')).toHaveValue(GAME_A.images[1])

    const description = screen.getByLabelText('Description')
    await user.clear(description)
    await user.type(description, 'Nouvelle description')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByText('Le jeu Alpha Quest a été mis à jour.')).toBeInTheDocument()
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(patch[0]).toBe(`/api/games/${GAME_A.id}`)
    expect(JSON.parse(patch[1].body as string)).toEqual({ description: 'Nouvelle description' })
  })

  it('n\'appelle pas le serveur quand rien n\'a changé', async () => {
    signInAs('admin')
    const user = userEvent.setup()
    const fetchMock = routeFetch(() => jsonResponse(200, GAME_A))
    renderApp(`/games/${GAME_A.id}/edit`)
    await screen.findByLabelText('Nom')

    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByText('Aucune modification à enregistrer.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  })

  it('affiche le 404 d\'un jeu supprimé entre-temps', async () => {
    signInAs('admin')
    routeFetch(() => jsonResponse(404, { error: 'not_found' }))
    renderApp(`/games/${GAME_A.id}/edit`)
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce jeu est introuvable.')
  })
})
