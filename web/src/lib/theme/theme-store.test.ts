import { vi } from 'vitest'

import { resolveTheme, themeStore, THEME_STORAGE_KEY } from './theme-store'

function stubSystem(light: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: light && query.includes('light'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.removeItem(THEME_STORAGE_KEY)
  themeStore.reload()
})

it('« system » suit le système, sombre par défaut sans information', () => {
  expect(resolveTheme('system')).toBe('dark')
  stubSystem(true)
  expect(resolveTheme('system')).toBe('light')
  stubSystem(false)
  expect(resolveTheme('system')).toBe('dark')
  expect(resolveTheme('light')).toBe('light')
})

it('applique le thème à <html> et le mémorise', () => {
  stubSystem(true)
  themeStore.set('dark')
  expect(document.documentElement).toHaveClass('dark')
  expect(document.documentElement.style.colorScheme).toBe('dark')
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

  themeStore.set('system')
  expect(themeStore.get()).toBe('system')
  expect(themeStore.resolved()).toBe('light')
  expect(document.documentElement).not.toHaveClass('dark')
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
})
