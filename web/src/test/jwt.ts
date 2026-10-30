import type { Role } from '@/lib/auth/jwt'

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Faux JWT (signature factice) : l'interface ne lit que les claims.
export function makeJwt(role: Role = 'user', username = 'alice'): string {
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const payload = encode({
    sub: '00000000-0000-4000-8000-000000000001',
    username,
    role,
    iat: 1,
    exp: 4102444800,
  })
  return `${header}.${payload}.signature`
}
