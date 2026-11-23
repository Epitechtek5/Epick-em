import { ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import type { Identity } from '@/hooks/use-participant-identities'
import { useI18n } from '@/i18n/context'

// Ordre des têtes de série pour un lancement en seeding manuel : la tête de série 1 en premier,
// réordonnée au clavier (Monter / Descendre), chaque déplacement annoncé ; le focus suit le
// participant déplacé. Le serveur vérifie que la liste contient exactement les participants admis.
export function SeedOrderEditor({
  order,
  identity,
  onChange,
  disabled,
}: {
  order: readonly string[]
  identity: (participantId: string) => Identity
  onChange: (order: string[]) => void
  disabled?: boolean
}) {
  const { t } = useI18n()
  const [announcement, setAnnouncement] = useState('')
  const focusTarget = useRef<string | null>(null)

  useEffect(() => {
    if (!focusTarget.current) return
    document.getElementById(focusTarget.current)?.focus()
    focusTarget.current = null
  })

  const buttonId = (participantId: string, action: 'up' | 'down') => `seed-${participantId}-${action}`

  function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= order.length) return
    const next = [...order]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
    const id = order[index]
    setAnnouncement(t('steps.seeding.moved', { name: identity(id).name, seed: target + 1 }))
    const atEdge = delta === -1 ? target === 0 : target === order.length - 1
    focusTarget.current = buttonId(id, atEdge ? (delta === -1 ? 'down' : 'up') : delta === -1 ? 'up' : 'down')
  }

  return (
    <div className="grid gap-2">
      <ol aria-label={t('steps.seeding.list')} className="grid max-h-96 gap-1.5 overflow-y-auto pr-1">
        {order.map((id, index) => {
          const name = identity(id).name
          return (
            <li key={id} className="flex items-center gap-3 rounded-lg bg-background/60 px-3 py-1.5 ring-1 ring-foreground/10 dark:bg-input/20">
              <span
                aria-hidden="true"
                className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 font-mono text-xs font-bold text-primary dark:bg-primary/25 dark:text-violet-200"
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="sr-only">{t('steps.seeding.seed', { seed: index + 1 })}{t('common.colon')} </span>
                {name}
              </span>
              <Button
                id={buttonId(id, 'up')}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('steps.seeding.up', { name })}
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
              >
                <Icon icon={ArrowUp01Icon} />
              </Button>
              <Button
                id={buttonId(id, 'down')}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('steps.seeding.down', { name })}
                disabled={disabled || index === order.length - 1}
                onClick={() => move(index, 1)}
              >
                <Icon icon={ArrowDown01Icon} />
              </Button>
            </li>
          )
        })}
      </ol>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}
