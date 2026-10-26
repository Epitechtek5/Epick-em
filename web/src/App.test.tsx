import { screen } from '@testing-library/react'

import { tokenStore } from '@/lib/auth/token-store'
import { renderApp } from '@/test/render'

describe('App', () => {
  it('redirige un visiteur anonyme vers la connexion', async () => {
    renderApp('/')

    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument()
  })

  it('renvoie un utilisateur déjà connecté de /login vers la page principale', async () => {
    tokenStore.set({ accessToken: 'jwt' })
    renderApp('/login')

    expect(await screen.findByRole('heading', { level: 1, name: /Bonjour/ })).toBeInTheDocument()
  })

  it('protège la zone authentifiée', async () => {
    renderApp('/app')

    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument()
  })

  it('propose un lien d\'évitement et un repère principal', () => {
    renderApp('/register')

    expect(screen.getByRole('link', { name: 'Aller au contenu principal' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('affiche une page 404', () => {
    renderApp('/inconnue')

    expect(screen.getByRole('heading', { name: 'Page introuvable' })).toBeInTheDocument()
  })
})
