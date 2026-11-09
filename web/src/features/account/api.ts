import { apiRequest } from '@/lib/api/client'

// Profil du compte connecté (GET /me, PATCH /me/update). Seule source des adresses
// e-mail affichées : celles des autres comptes ne sont jamais montrées.
export interface SelfProfile {
  id: string
  username: string
  role: string
  // Adresse confirmée (ou adresse d'inscription pas encore confirmée).
  email: string | null
  // Nouvelle adresse demandée, en attente de confirmation par lien.
  pending_email: string | null
  email_verified_at: string | null
}

export function getMe(signal?: AbortSignal) {
  return apiRequest<SelfProfile>('/me', { signal })
}

// PATCH /me/update { email } -> 200 SelfProfile | 400 | 401 | 409 (`email_taken`).
// L'adresse est envoyée telle que saisie ; le serveur envoie un lien de confirmation et
// garde l'adresse actuelle tant que la nouvelle n'est pas confirmée.
export function updateEmail(email: string) {
  return apiRequest<SelfProfile>('/me/update', { method: 'PATCH', body: { email } })
}
