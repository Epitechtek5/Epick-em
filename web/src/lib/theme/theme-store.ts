import type { SettingsTheme } from '@/features/settings/api'

export const THEME_STORAGE_KEY = 'epickem-theme'
const LIGHT_QUERY = '(prefers-color-scheme: light)'

function isTheme(value: unknown): value is SettingsTheme {
  return value === 'system' || value === 'light' || value === 'dark'
}

function readStored(): SettingsTheme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (isTheme(stored)) return stored
  } catch {
    // stockage indisponible : thème du système
  }
  return 'system'
}

function systemQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(LIGHT_QUERY) : null
}

// Thème effectif : « system » suit le système ; sans information, le sombre reste le
// thème par défaut de l'application.
export function resolveTheme(theme: SettingsTheme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  const query = systemQuery()
  return query?.matches ? 'light' : 'dark'
}

function applyToDocument(theme: SettingsTheme) {
  const resolved = resolveTheme(theme)
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document.documentElement.style.colorScheme = resolved
}

// Thème choisi, observable (useSyncExternalStore). Appliqué immédiatement à <html> et
// mémorisé localement pour le prochain chargement (voir le script de index.html).
// Le compte connecté le synchronise avec ses réglages (SettingsProvider).
function createThemeStore() {
  let current: SettingsTheme = readStored()
  let resolved = resolveTheme(current)
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())

  applyToDocument(current)
  systemQuery()?.addEventListener?.('change', () => {
    if (current !== 'system') return
    applyToDocument(current)
    resolved = resolveTheme(current)
    notify()
  })

  return {
    get: () => current,
    resolved: () => resolved,
    set(theme: SettingsTheme) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, theme)
      } catch {
        // le thème reste utilisable lorsque le stockage est désactivé
      }
      applyToDocument(theme)
      if (theme === current && resolveTheme(theme) === resolved) return
      current = theme
      resolved = resolveTheme(theme)
      notify()
    },
    // Relit le stockage (tests, autre onglet).
    reload() {
      this.set(readStored())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export const themeStore = createThemeStore()
