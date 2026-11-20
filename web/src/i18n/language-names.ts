import type { Lang } from './context'

// Chaque langue est nommée dans sa propre langue (attribut lang posé par l'appelant).
const NAMES: Record<Lang, string> = { fr: 'Français', en: 'English', es: 'Español' }

export function languageName(lang: Lang): string {
  return NAMES[lang]
}
