export type Role = 'user' | 'admin' | 'watcher'

const ROLES: readonly Role[] = ['user', 'admin', 'watcher']

export interface Claims {
  sub: string
  username: string
  role: Role
  exp: number
}

function decodeBase64Url(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

// Lit les claims du jeton d'accès SANS vérifier la signature : ils ne servent qu'à
// adapter l'interface (rôle, nom affiché). Le serveur reste seul juge des droits, et
// relit le rôle en base pour toutes les routes réservées aux administrateurs.
export function decodeClaims(token: string): Claims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload: unknown = JSON.parse(decodeBase64Url(parts[1]))
    if (typeof payload !== 'object' || payload === null) return null
    const { sub, username, role, exp } = payload as Record<string, unknown>
    if (typeof sub !== 'string' || typeof username !== 'string') return null
    if (typeof exp !== 'number') return null
    if (!ROLES.includes(role as Role)) return null
    return { sub, username, role: role as Role, exp }
  } catch {
    return null
  }
}
