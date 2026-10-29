import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface StateMessageProps {
  kind: 'loading' | 'empty' | 'error' | 'success'
  children: ReactNode
  action?: ReactNode
}

// Retour d'état annoncé aux lecteurs d'écran. Le sens ne repose jamais sur la seule
// couleur : le texte dit ce qui se passe (WCAG 1.4.1).
export function StateMessage({ kind, children, action }: StateMessageProps) {
  const isError = kind === 'error'
  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-busy={kind === 'loading' ? true : undefined}
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm',
        isError ? 'border-destructive' : kind === 'success' ? 'border-primary' : 'border-border',
      )}
    >
      <p className={cn(isError && 'text-destructive')}>{children}</p>
      {action}
    </div>
  )
}
