import { render, screen } from '@testing-library/react'

import App from './App'

describe('App', () => {
  it("affiche le titre et l'action principale", () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { level: 1, name: "Epick'em" }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Commencer' })).toBeEnabled()
  })
})
