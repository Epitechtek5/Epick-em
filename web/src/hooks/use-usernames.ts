import { useEffect, useState } from 'react'

import { getUser } from '@/features/users/api'

// Noms d'utilisateur des comptes demandés (GET /user/{id}, une requête par compte distinct).
// Un compte introuvable ou une erreur laisse l'entrée absente : l'appelant affiche un repli.
export function useUsernames(ids: readonly string[]): Record<string, string> {
  const key = [...new Set(ids)].sort().join(',')
  const [names, setNames] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    let active = true
    void Promise.all(
      key.split(',').map((id) =>
        getUser(id, controller.signal).then(
          (user) => [id, user.username] as const,
          () => null,
        ),
      ),
    ).then((entries) => {
      if (!active) return
      setNames((current) => {
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

  return names
}
