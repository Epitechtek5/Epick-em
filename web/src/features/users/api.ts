import { apiRequest } from '@/lib/api/client'
import { uuid } from '@/features/teams/validation'

// Profil public d'un compte (GET /users, GET /user/{id}).
export interface UserProfile {
  id: string
  username: string
  role: 'user' | 'admin' | 'watcher'
}

export async function listUsers(query: { limit?: number; offset?: number } = {}, signal?: AbortSignal) {
  const params = new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, Math.trunc(query.limit ?? 50)))),
    offset: String(Math.max(0, Math.trunc(query.offset ?? 0))),
  })
  return apiRequest<UserProfile[]>(`/users?${params}`, { signal })
}

// Tous les comptes, par pages de 100 (pour proposer les membres à ajouter).
export async function listAllUsers(signal?: AbortSignal): Promise<UserProfile[]> {
  const all: UserProfile[] = []
  for (let offset = 0; offset < 2000; offset += 100) {
    const page = await listUsers({ limit: 100, offset }, signal)
    all.push(...page)
    if (page.length < 100) break
  }
  return all
}

export async function getUser(id: string, signal?: AbortSignal) {
  return apiRequest<UserProfile>(`/user/${uuid(id)}`, { signal })
}
