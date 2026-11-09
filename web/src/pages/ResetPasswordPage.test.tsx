import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { jsonResponse, mockFetch, renderApp } from '@/test/render'
import { tokenStore } from '@/lib/auth/token-store'

describe('ResetPasswordPage', () => {
  it('refuse un lien sans jeton', () => {
    renderApp('/reset-password')

    expect(
      screen.getByRole('heading', { name: 'Lien de réinitialisation invalide' }),
    ).toBeInTheDocument()
  })

  it('réinitialise le mot de passe sans authentification et vide la session locale', async () => {
    const fetchMock = mockFetch(jsonResponse(204))
    tokenStore.set({ accessToken: 'stale-access', refreshToken: 'stale-refresh' })
    const user = userEvent.setup()
    renderApp('/reset-password?token=opaque-token')

    await user.type(screen.getByLabelText('Nouveau mot de passe'), 'Password1!')
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), 'Password1!')
    await user.click(screen.getByRole('button', { name: 'Réinitialiser le mot de passe' }))

    expect(await screen.findByRole('heading', { name: 'Mot de passe modifié' })).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/reset-password')
    expect(init.headers.Authorization).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual({
      token: 'opaque-token',
      password: 'Password1!',
    })
    expect(tokenStore.get()).toBeNull()
  })

  it('affiche un état neutre pour un jeton expiré ou déjà utilisé', async () => {
    mockFetch(jsonResponse(400, { error: 'invalid_reset_token' }))
    const user = userEvent.setup()
    renderApp('/reset-password?token=opaque-token')

    await user.type(screen.getByLabelText('Nouveau mot de passe'), 'Password1!')
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), 'Password1!')
    await user.click(screen.getByRole('button', { name: 'Réinitialiser le mot de passe' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Ce lien est invalide, expiré ou a déjà été utilisé.',
      ),
    )
  })
})
