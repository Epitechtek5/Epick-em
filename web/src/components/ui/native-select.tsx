import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

// <select> natif aux couleurs du thème (clavier et lecteurs d'écran gérés par le navigateur).
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-8 min-w-0 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30',
        className,
      )}
      {...props}
    />
  )
}
