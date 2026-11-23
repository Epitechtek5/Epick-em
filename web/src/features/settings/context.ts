import { createContext, useContext, useMemo } from 'react'

import type { Lang } from '@/i18n/context'
import { useI18n } from '@/i18n/context'
import { themeStore } from '@/lib/theme/theme-store'
import {
  defaultNotifications,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPreferences,
  type SettingsTheme,
} from './api'

export type SettingsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SettingsValue {
  // 'idle' sans session ; 'error' si les réglages du compte n'ont pas pu être chargés.
  status: SettingsStatus
  notifications: NotificationPreferences
  // Une écriture est en cours.
  saving: boolean
  // Dernière écriture refusée ou impossible (clé de traduction), null sinon.
  saveError: 'settings.saveFailed' | null
  // Photo de profil du compte connecté (URL http(s)), null sans photo ou sans session.
  pictureUrl: string | null
  reload: () => void
  setLanguage: (language: Lang) => void
  setTheme: (theme: SettingsTheme) => void
  setNotification: (category: NotificationCategory, channel: NotificationChannel, enabled: boolean) => void
  setPictureUrl: (url: string | null) => void
}

export const SettingsContext = createContext<SettingsValue | null>(null)

const noop = () => {}
const setLocalTheme = (theme: SettingsTheme) => themeStore.set(theme)

// Sans fournisseur (tests de composants isolés, pages publiques), les réglages restent
// locaux : langue et thème s'appliquent sans être enregistrés sur un compte. La valeur est
// stable d'un rendu à l'autre (les fonctions servent de dépendances d'effets).
function useLocalSettings(): SettingsValue {
  const { setLang } = useI18n()
  return useMemo(
    () => ({
      status: 'idle',
      notifications: defaultNotifications(),
      saving: false,
      saveError: null,
      pictureUrl: null,
      reload: noop,
      setLanguage: setLang,
      setTheme: setLocalTheme,
      setNotification: noop,
      setPictureUrl: noop,
    }),
    [setLang],
  )
}

export function useSettings(): SettingsValue {
  const context = useContext(SettingsContext)
  const local = useLocalSettings()
  return context ?? local
}
