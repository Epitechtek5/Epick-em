import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { getMe } from '@/features/account/api'
import { useI18n, type Lang } from '@/i18n/context'
import { useAuth } from '@/lib/auth/auth-context'
import { themeStore } from '@/lib/theme/theme-store'
import {
  defaultNotifications,
  getSettings,
  updateSettings,
  type NotificationPreferences,
  type SettingsPatch,
  type SettingsTheme,
  type UserSettings,
} from './api'
import { SettingsContext, type SettingsStatus, type SettingsValue } from './context'

// Réglages du compte connecté, comme sur mobile (features/preferences/provider.tsx) :
// chargés à l'ouverture de session (GET /me/settings) puis appliqués (langue, thème) ;
// chaque modification s'applique tout de suite puis est enregistrée (PATCH /me/settings).
// Les écritures partent l'une après l'autre ; seule la réponse de la dernière remplace
// l'état local. La file d'écritures appartient à la session : à la déconnexion ou au
// changement de compte, les écritures en attente sont annulées avant d'être envoyées
// (elles partiraient sinon avec les jetons du compte suivant) et leurs réponses ignorées. En cas d'échec, les préférences de notification reviennent au dernier
// état confirmé par le serveur ; la langue et le thème restent appliqués localement.
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth()
  const { setLang } = useI18n()
  const [attempt, setAttempt] = useState(0)
  const [notifications, setNotifications] = useState<NotificationPreferences>(defaultNotifications)
  const [pending, setPending] = useState(0)
  // États rattachés au compte (et à la tentative) qui les a produits : un changement de
  // session les invalide sans les remettre à zéro dans un effet.
  const loadKey = userId ? `${userId}:${attempt}` : null
  const [loaded, setLoaded] = useState<{ key: string; status: 'ready' | 'error' } | null>(null)
  const [failure, setFailure] = useState<{ userId: string; error: 'settings.saveFailed' } | null>(null)
  const [picture, setPicture] = useState<{ userId: string; url: string | null } | null>(null)
  const status: SettingsStatus = !loadKey ? 'idle' : loaded?.key === loadKey ? loaded.status : 'loading'
  const saveError = userId && failure?.userId === userId ? failure.error : null
  const pictureUrl = userId && picture?.userId === userId ? picture.url : null

  const current = useRef(notifications)
  const confirmed = useRef<UserSettings | null>(null)
  const writes = useRef<Promise<unknown>>(Promise.resolve())
  const revision = useRef(0)
  const generation = useRef(0)
  const session = useRef<AbortController | null>(null)

  // Une session par compte connecté : quand userId change (déconnexion, autre compte),
  // l'ancienne est annulée et la file d'écritures repart de zéro.
  useEffect(() => {
    const controller = new AbortController()
    session.current = controller
    writes.current = Promise.resolve()
    return () => {
      controller.abort()
      if (session.current === controller) session.current = null
    }
  }, [userId])

  const showNotifications = useCallback((next: NotificationPreferences) => {
    current.current = next
    setNotifications(next)
  }, [])

  const apply = useCallback(
    (settings: UserSettings) => {
      setLang(settings.language)
      themeStore.set(settings.theme)
      showNotifications(settings.notifications)
    },
    [setLang, showNotifications],
  )

  useEffect(() => {
    const operation = ++generation.current
    confirmed.current = null
    if (!userId || !loadKey) return

    const controller = new AbortController()
    const startRevision = revision.current
    getSettings(controller.signal)
      .then((settings) => {
        if (operation !== generation.current) return
        confirmed.current = settings
        // Une modification faite pendant le chargement l'emporte sur la valeur lue.
        if (revision.current === startRevision) apply(settings)
        setLoaded({ key: loadKey, status: 'ready' })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (operation === generation.current) setLoaded({ key: loadKey, status: 'error' })
      })
    getMe(controller.signal)
      .then((profile) => {
        if (operation === generation.current) setPicture({ userId, url: profile.picture_url ?? null })
      })
      .catch(() => {
        // photo facultative : les initiales restent affichées
      })
    return () => controller.abort()
  }, [userId, loadKey, apply])

  const save = useCallback(
    (changes: SettingsPatch) => {
      const signal = session.current?.signal
      if (!userId || !signal || signal.aborted) return
      const write = ++revision.current
      setPending((count) => count + 1)
      const request = writes.current
        .catch(() => undefined)
        .then(() => {
          // Écriture différée : la session a pu changer pendant l'attente.
          signal.throwIfAborted()
          return updateSettings(changes, signal)
        })
      writes.current = request
      request
        .then(
          (settings) => {
            if (signal.aborted) return
            confirmed.current = settings
            if (write !== revision.current) return
            apply(settings)
            setFailure(null)
          },
          () => {
            if (signal.aborted) return
            setFailure({ userId, error: 'settings.saveFailed' })
            if (write === revision.current && confirmed.current) {
              showNotifications(confirmed.current.notifications)
            }
          },
        )
        .finally(() => setPending((count) => count - 1))
    },
    [userId, apply, showNotifications],
  )

  const value = useMemo<SettingsValue>(
    () => ({
      status,
      notifications,
      saving: pending > 0,
      saveError,
      pictureUrl,
      reload: () => setAttempt((count) => count + 1),
      setLanguage(language: Lang) {
        setLang(language)
        save({ language })
      },
      setTheme(theme: SettingsTheme) {
        themeStore.set(theme)
        save({ theme })
      },
      setNotification(category, channel, enabled) {
        showNotifications({
          ...current.current,
          [category]: { ...current.current[category], [channel]: enabled },
        })
        save({ notifications: { [category]: { [channel]: enabled } } })
      },
      setPictureUrl(url: string | null) {
        if (userId) setPicture({ userId, url })
      },
    }),
    [userId, status, notifications, pending, saveError, pictureUrl, setLang, save, showNotifications],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
