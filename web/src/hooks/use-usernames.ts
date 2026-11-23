import { useEffect, useMemo, useState } from 'react'

import { getUser, type UserProfile } from '@/features/users/api'

// Profils publics des comptes demandés (GET /user/{id}, une requête par compte distinct).
// Un compte introuvable ou une erreur laisse l'entrée absente : l'appelant affiche un repli.
export function useUserProfiles(ids: readonly string[]): Record<string, UserProfile> {
  const key = [...new Set(ids)].sort().join(',')
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({})

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    let active = true
    void Promise.all(
      key.split(',').map((id) =>
        getUser(id, controller.signal).then(
          (user) => [id, user] as const,
          () => null,
        ),
      ),
    ).then((entries) => {
      if (!active) return
      setProfiles((current) => {
        const next = { ...current }
        for (const entry of entries) if (entry) next[entry[0]] = entry[1]
        return next
      })
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [key])

  return profiles
}

// Noms d'utilisateur des comptes demandés (voir useUserProfiles).
export function useUsernames(ids: readonly string[]): Record<string, string> {
  const profiles = useUserProfiles(ids)
  return useMemo(
    () => Object.fromEntries(Object.entries(profiles).map(([id, user]) => [id, user.username])),
    [profiles],
  )
}
