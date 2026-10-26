import { screen, within } from '@testing-library/react'

import { renderApp, renderSignedIn } from '@/test/render'

describe('HomePage', () => {
  it("accueille l'utilisateur connecté", async () => {
    await renderSignedIn('alice')

    expect(screen.getByRole('heading', { level: 1, name: 'Bonjour, alice' })).toBeInTheDocument()
    expect(document.title).toBe("Accueil · Epick'em")
  })

  it('présente les quatre blocs du tableau de bord sous des titres de niveau 2', async () => {
    await renderSignedIn()

    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(titles).toEqual([
      'Tournois en direct',
      'Mes pronostics',
      'Classement général',
      'Mes groupes',
    ])
    expect(screen.getAllByRole('region')).toHaveLength(4)
  })

  it("indique l'état vide en texte", async () => {
    await renderSignedIn()

    const section = screen.getByRole('region', { name: 'Tournois en direct' })
    expect(within(section).getByText('Bientôt disponible')).toBeInTheDocument()
    expect(within(section).getByText(/Aucun tournoi/)).toBeInTheDocument()
  })

  it('affiche la navigation principale avec la page courante', async () => {
    await renderSignedIn()

    const nav = screen.getByRole('navigation', { name: 'Navigation principale' })
    expect(within(nav).getByRole('link', { name: 'Accueil' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByText('Connecté en tant que')).toBeInTheDocument()
  })

  it("n'affiche ni navigation ni déconnexion aux visiteurs", () => {
    renderApp('/login')

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Se déconnecter' })).not.toBeInTheDocument()
  })

  it("déconnecte depuis l'en-tête et ramène à la connexion", async () => {
    const user = await renderSignedIn()

    await user.click(screen.getByRole('button', { name: 'Se déconnecter' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument()
  })
})
