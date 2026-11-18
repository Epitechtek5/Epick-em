import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from './I18nProvider'
import { LanguageSwitcher } from './LanguageSwitcher'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderSwitcher() {
  render(
    <I18nProvider>
      <LanguageSwitcher />
      <button type="button">Ailleurs</button>
    </I18nProvider>,
  )
}

it('ouvre un menu de langues, change la langue et rend le focus au bouton', async () => {
  const user = userEvent.setup()
  renderSwitcher()
  const button = screen.getByRole('button', { name: 'Langue : Français' })
  expect(button).toHaveAttribute('aria-expanded', 'false')
  await user.click(button)
  expect(button).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('menuitemradio', { name: 'Français' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('menuitemradio', { name: 'Français' })).toHaveFocus()
  await user.click(screen.getByRole('menuitemradio', { name: 'English' }))
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Language: English' })).toHaveFocus()
})

it('se pilote au clavier et se ferme avec Échap ou un clic extérieur', async () => {
  const user = userEvent.setup()
  renderSwitcher()
  const button = screen.getByRole('button', { name: 'Langue : Français' })
  button.focus()
  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitemradio', { name: 'Français' })).toHaveFocus()
  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveFocus()
  await user.keyboard('{End}')
  expect(screen.getByRole('menuitemradio', { name: 'Español' })).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(button).toHaveFocus()

  await user.click(button)
  await user.click(screen.getByRole('button', { name: 'Ailleurs' }))
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Langue : Français' })).toBeInTheDocument()
})
