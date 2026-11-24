import { optionLabel } from '@/features/stats/options'
import type { Stat } from '@/features/stats/types'
import { formatPoints } from '@/features/tournaments/format'
import type { Lang } from '@/i18n/context'
import type { StatValue } from './types'

// Valeur lisible d'une statistique : nombre localisé, libellé de l'option d'un choix (la clé si
// la valeur a été retirée), nom du joueur ou du participant pour un MVP.
export function formatStatValue(
  stat: Stat | undefined,
  value: StatValue,
  lang: Lang,
  nameOf: (id: string) => string = (id) => id,
): string {
  if (typeof value === 'number') return formatPoints(lang, value)
  if (stat?.type === 'mvp') return nameOf(value)
  return optionLabel(stat?.options, value)
}
