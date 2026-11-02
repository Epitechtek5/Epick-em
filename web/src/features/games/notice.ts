import type { MessageKey, Params } from '@/i18n/context'

// Confirmation transmise à la page suivante via l'état de navigation.
export interface Notice {
  key: MessageKey
  params?: Params
}

export function readNotice(state: unknown): Notice | null {
  if (typeof state !== 'object' || state === null || !('notice' in state)) return null
  const notice = (state as { notice: unknown }).notice
  if (typeof notice !== 'object' || notice === null || !('key' in notice)) return null
  return notice as Notice
}
