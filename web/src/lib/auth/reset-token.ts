// Jeton du lien de réinitialisation : un seul paramètre `token`, non vide. Sinon le lien
// est considéré comme incomplet. La valeur n'est jamais journalisée ni stockée.
export function readResetToken(search: string): string | null {
  const values = new URLSearchParams(search).getAll('token')
  return values.length === 1 && values[0].length > 0 ? values[0] : null
}
