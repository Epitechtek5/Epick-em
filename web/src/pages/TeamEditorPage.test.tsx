import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  GAME_A,
  GAME_B,
  jsonResponse,
  ME,
  renderApp,
  routeFetch,
  signInAs,
  TEAM_MINE,
  TEAM_OTHER,
  userResponse,
} from '@/test/render'

function server(on?: (path: string, init: RequestInit) => Response | undefined) {
  return routeFetch((path, init) => {
    const custom = on?.(path, init)
    if (custom) return custom
    const user = userResponse(path)
    if (user) return user
    if (path.startsWith('/games?')) return jsonResponse(200, [GAME_A, GAME_B])
    if (path.startsWith('/games/')) return jsonResponse(200, GAME_A)
    if (path === '/teams' && init.method === 'POST') {
      const body = JSON.parse(init.body as string)
      return jsonResponse(201, { ...TEAM_MINE, ...body, tag: body.tag ?? null, picture_url: body.picture_url ?? null })
    }
    if (path === `/teams/${TEAM_MINE.id}` && init.method === 'PATCH') {
      return jsonResponse(200, { ...TEAM_MINE, ...JSON.parse(init.body as string) })
    }
    if (path === `/teams/${TEAM_MINE.id}`) return jsonResponse(200, TEAM_MINE)
    if (path === `/teams/${TEAM_OTHER.id}`) return jsonResponse(200, TEAM_OTHER)
    if (path.endsWith('/members')) return jsonResponse(200, [])
    if (path.startsWith('/users')) return jsonResponse(200, [])
    return jsonResponse(404, { error: 'not_found' })
  })
}

const posted = (fetchMock: ReturnType<typeof server>, method: string) => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method)
  return call ? JSON.parse(call[1].body as string) : undefined
}

describe('TeamEditorPage', () => {
  it('tout compte crée une équipe (201) et en devient propriétaire', async () => {
    signInAs('watcher')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp('/teams/new')

    await user.selectOptions(await screen.findByLabelText('Jeu'), GAME_A.id)
    await user.type(screen.getByLabelText('Nom'), '  Karmine Corp ')
    await user.type(screen.getByLabelText('Tag (facultatif)'), 'KC')
    await user.click(screen.getByRole('button', { name: 'Créer une équipe' }))

    expect(await screen.findByText('L’équipe Karmine Corp a été créée. Vous en êtes le propriétaire.')).toBeInTheDocument()
    expect(posted(fetchMock, 'POST')).toEqual({ game_id: GAME_A.id, name: 'Karmine Corp', tag: 'KC' })
    expect(await screen.findByText('alice (vous)')).toBeInTheDocument()
  })

  it('valide localement sans requête (nom, tag, photo, jeu) et lie les erreurs aux champs', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp('/teams/new')
    await screen.findByLabelText('Jeu')

    await user.type(screen.getByLabelText('Tag (facultatif)'), 'TROPLONGTAG')
    await user.type(screen.getByLabelText('URL de la photo de profil (facultatif)'), 'ftp://x')
    await user.click(screen.getByRole('button', { name: 'Créer une équipe' }))

    expect(await screen.findByText('Corrigez les erreurs suivantes :')).toBeInTheDocument()
    expect(screen.getByLabelText('Nom')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Nom')).toHaveAccessibleDescription(/Saisissez un nom de 1 à 64 caractères/)
    expect(screen.getByLabelText('Tag (facultatif)')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Jeu')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('URL de la photo de profil (facultatif)')).toHaveAttribute('aria-invalid', 'true')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('affiche 409 team_name_taken sur le champ Nom', async () => {
    signInAs('user')
    const user = userEvent.setup()
    server((path, init) =>
      path === '/teams' && init.method === 'POST' ? jsonResponse(409, { error: 'team_name_taken' }) : undefined,
    )
    renderApp('/teams/new')
    await user.selectOptions(await screen.findByLabelText('Jeu'), GAME_A.id)
    await user.type(screen.getByLabelText('Nom'), 'karmine corp')
    await user.click(screen.getByRole('button', { name: 'Créer une équipe' }))

    expect(await screen.findByText('Une équipe de ce jeu porte déjà ce nom.', { selector: 'a' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nom')).toHaveAttribute('aria-invalid', 'true')
  })

  it('le propriétaire modifie et efface le tag et la photo (chaînes vides)', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp(`/teams/${TEAM_MINE.id}/edit`)

    const tag = await screen.findByLabelText('Tag (facultatif)')
    expect(screen.queryByLabelText('Jeu')).not.toBeInTheDocument()
    await user.clear(tag)
    await user.clear(screen.getByLabelText('URL de la photo de profil (facultatif)'))
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByText('L’équipe Karmine Corp a été mise à jour.')).toBeInTheDocument()
    expect(posted(fetchMock, 'PATCH')).toEqual({ tag: '', picture_url: '' })
  })

  it('n\'envoie rien sans modification', async () => {
    signInAs('user')
    const user = userEvent.setup()
    const fetchMock = server()
    renderApp(`/teams/${TEAM_MINE.id}/edit`)
    await screen.findByLabelText('Nom')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText('Aucune modification à enregistrer.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  })

  it.each(['user', 'admin'] as const)('refuse le formulaire de modification à un non-propriétaire (%s)', async (role) => {
    signInAs(role)
    server()
    renderApp(`/teams/${TEAM_OTHER.id}/edit`)
    expect(
      await screen.findByText('Vous n’êtes pas le propriétaire de cette équipe : elle est en lecture seule.'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Nom')).not.toBeInTheDocument()
    expect(ME.id).not.toBe(TEAM_OTHER.owner_id)
  })

  it('explique l\'absence de jeux', async () => {
    signInAs('user')
    routeFetch(() => jsonResponse(200, []))
    renderApp('/teams/new')
    expect(await screen.findByText(/Aucun jeu n’existe encore/)).toBeInTheDocument()
  })
})
