import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeToggle } from './ThemeToggle'

afterEach(() => {
  cleanup()
  localStorage.removeItem('epickem-theme')
  document.documentElement.classList.remove('dark')
  document.documentElement.style.colorScheme = ''
})

it('active le mode sombre par défaut et conserve le choix après remontage', async () => {
  localStorage.removeItem('epickem-theme')
  const user = userEvent.setup()
  const view = render(<ThemeToggle />)
  expect(document.documentElement).toHaveClass('dark')
  await user.click(screen.getByRole('button', { name: 'Passer en mode clair' }))
  expect(document.documentElement).not.toHaveClass('dark')
  expect(localStorage.getItem('epickem-theme')).toBe('light')
  view.unmount()
  render(<ThemeToggle />)
  expect(screen.getByRole('button', { name: 'Passer en mode sombre' })).toHaveAttribute('aria-pressed', 'false')
  await user.click(screen.getByRole('button', { name: 'Passer en mode sombre' }))
  expect(document.documentElement).toHaveClass('dark')
  expect(localStorage.getItem('epickem-theme')).toBe('dark')
})
