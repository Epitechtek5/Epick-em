import { apiRequest } from '@/lib/api/client'

// Réglages du compte connecté (GET/PATCH /me/settings). Mêmes valeurs que l'application
// mobile : langue, thème et préférences de notification par catégorie et par canal.
export type SettingsLanguage = 'fr' | 'en' | 'es'
export type SettingsTheme = 'system' | 'light' | 'dark'
export type NotificationCategory =
  | 'tournaments'
  | 'teams'
  | 'matches'
  | 'predictions'
  | 'pickem'
  | 'rankings'
  | 'account'
export type NotificationChannel = 'email' | 'push'

export interface ChannelPreferences {
  email: boolean
  push: boolean
}

export type NotificationPreferences = Record<NotificationCategory, ChannelPreferences>

export interface UserSettings {
  language: SettingsLanguage
  theme: SettingsTheme
  notifications: NotificationPreferences
}

// Mise à jour partielle : seules les clés envoyées sont modifiées côté serveur.
export interface SettingsPatch {
  language?: SettingsLanguage
  theme?: SettingsTheme
  notifications?: Partial<Record<NotificationCategory, Partial<ChannelPreferences>>>
}

export const LANGUAGES: readonly SettingsLanguage[] = ['fr', 'en', 'es']
export const THEMES: readonly SettingsTheme[] = ['system', 'light', 'dark']
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['email', 'push']
export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'tournaments',
  'teams',
  'matches',
  'predictions',
  'pickem',
  'rankings',
  'account',
]

export function defaultNotifications(): NotificationPreferences {
  return Object.fromEntries(
    NOTIFICATION_CATEGORIES.map((category) => [category, { email: true, push: true }]),
  ) as NotificationPreferences
}

// GET /me/settings -> 200 UserSettings | 401.
export function getSettings(signal?: AbortSignal) {
  return apiRequest<UserSettings>('/me/settings', { signal })
}

// PATCH /me/settings -> 200 UserSettings (réglages complets après fusion) | 400 | 401.
export function updateSettings(changes: SettingsPatch, signal?: AbortSignal) {
  return apiRequest<UserSettings>('/me/settings', { method: 'PATCH', body: changes, signal })
}
