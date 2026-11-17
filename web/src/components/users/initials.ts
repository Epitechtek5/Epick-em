// Initiales affichées sans photo : deux premières lettres des mots du nom, sinon les deux
// premiers caractères (« alice » -> « AL », « jean-paul » -> « JP »).
export function initials(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean)
  const letters =
    words.length >= 2 ? `${[...words[0]][0]}${[...words[1]][0]}` : [...(words[0] ?? '')].slice(0, 2).join('')
  return letters.toUpperCase() || '?'
}
