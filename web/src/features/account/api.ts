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
  // Photo de profil (URL http(s)), visible des autres comptes ; null sans photo.
  picture_url?: string | null
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

// PATCH /me/update { picture_url } -> 200 SelfProfile | 400 (`picture_url` invalide) | 401.
// Une chaîne vide efface la photo.
export function updatePicture(pictureUrl: string) {
  return apiRequest<SelfProfile>('/me/update', {
    method: 'PATCH',
    body: { picture_url: pictureUrl.trim() },
  })
}

export const PICTURE_URL_MAX = 2048

// Même règle que le serveur (is_image_url) et que l'application mobile : URL http(s)
// sans espace, 2048 octets au plus. Une valeur vide est acceptée (suppression).
export function validatePictureUrl(value: string): 'account.picture.invalid' | null {
  const url = value.trim()
  if (!url) return null
  if (!/^https?:\/\/\S+$/i.test(url)) return 'account.picture.invalid'
  if (new TextEncoder().encode(url).length > PICTURE_URL_MAX) return 'account.picture.invalid'
  return null
}

// PATCH /me/update { username } -> 200 SelfProfile | 400 | 401 | 409 (`username_taken`).
// Le nom affiché vient du jeton d'accès : la session doit être renouvelée ensuite.
export function updateUsername(username: string) {
  return apiRequest<SelfProfile>('/me/update', { method: 'PATCH', body: { username: username.trim() } })
}

// PATCH /me/update { password } -> 200 SelfProfile | 400 | 401. Le serveur révoque alors
// tous les jetons de rafraîchissement du compte (toutes les sessions sont fermées).
export function updatePassword(password: string) {
  return apiRequest<SelfProfile>('/me/update', { method: 'PATCH', body: { password } })
}

// DELETE /me/delete -> 204 | 401 | 404. Supprime le compte et révoque ses sessions.
export async function deleteAccount(): Promise<void> {
  await apiRequest('/me/delete', { method: 'DELETE', expectedStatus: 204 })
}
