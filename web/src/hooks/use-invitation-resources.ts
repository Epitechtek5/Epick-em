import { useEffect, useState } from 'react'

import { invitationResourceName } from '@/features/invitations/api'
import type { InvitationType } from '@/features/invitations/types'

export const resourceKey = (type: InvitationType, id: string) => `${type}:${id}`

// Noms des ressources visées (équipe, équipe de tournoi, tournoi), une requête par ressource
// distincte. Une ressource supprimée ou invisible vaut null : l'appelant affiche un repli.
export function useInvitationResources(
  items: ReadonlyArray<{ type: InvitationType; resource_id: string }>,
): Record<string, string | null> {
  const key = [...new Set(items.map((item) => resourceKey(item.type, item.resource_id)))].sort().join(',')
  const [names, setNames] = useState<Record<string, string | null>>({})

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    let active = true
    void Promise.all(
      key.split(',').map(async (entry) => {
        const [type, id] = entry.split(':') as [InvitationType, string]
        return [entry, await invitationResourceName(type, id, controller.signal)] as const
      }),
    ).then((entries) => {
      if (active) setNames((current) => ({ ...current, ...Object.fromEntries(entries) }))
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [key])

  return names
}
