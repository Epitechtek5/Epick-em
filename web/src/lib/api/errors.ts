function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Message global renvoyé par le serveur, quelle que soit sa forme courante.
export function getErrorMessage(body: unknown): string | null {
  if (typeof body === 'string' && body.trim().length > 0) return body
  if (!isRecord(body)) return null
  for (const key of ['message', 'error', 'detail']) {
    const value = body[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

// Erreurs par champ si le serveur les détaille : { errors: { username: "..." | ["..."] } }.
export function getFieldErrors(
  body: unknown,
  fields: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {}
  if (!isRecord(body) || !isRecord(body.errors)) return result
  for (const field of fields) {
    const value = body.errors[field]
    const message = Array.isArray(value) ? value[0] : value
    if (typeof message === 'string' && message.length > 0) {
      result[field] = message
    }
  }
  return result
}
