import type { StatOption } from './types'
import { isValidKey, NAME_MAX } from './validation'

// Mêmes bornes que le serveur (api-public/stats.rs : check_options).
export const OPTIONS_MAX = 500

// Clé stable dérivée du libellé (slug sans accents), unique parmi `reserved`. Une clé déjà
// utilisée n'est jamais réattribuée : les résultats enregistrés gardent leur sens.
export function optionKey(label: string, reserved: readonly string[]): string {
  const base =
    label
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 54)
      .replace(/_+$/g, '') || 'option'
  let key = base
  for (let suffix = 2; reserved.includes(key); suffix += 1) key = `${base}_${suffix}`
  return key
}

export function isValidOptionLabel(label: string): boolean {
  const length = Array.from(label.trim()).length
  return length >= 1 && length <= NAME_MAX
}

// Problème d'une liste d'options (null si elle est valide) : au plus 500, clés slug distinctes,
// libellés de 1 à 64 caractères après trim.
export function optionsProblem(options: readonly StatOption[]): 'stats.validation.options' | null {
  if (options.length > OPTIONS_MAX) return 'stats.validation.options'
  const keys = new Set<string>()
  for (const option of options) {
    if (!isValidKey(option.key) || !isValidOptionLabel(option.label) || keys.has(option.key)) return 'stats.validation.options'
    keys.add(option.key)
  }
  return null
}

// Libellé affiché d'une valeur enregistrée ; une clé retirée depuis reste lisible.
export function optionLabel(options: readonly StatOption[] | undefined, key: string): string {
  return options?.find((option) => option.key === key)?.label ?? key
}
