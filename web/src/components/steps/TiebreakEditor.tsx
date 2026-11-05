import { Add01Icon, ArrowDown01Icon, ArrowUp01Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TIEBREAK_KEY_MAX, TIEBREAK_MAX, validTiebreakKey } from '@/features/steps/validation'
import { useI18n } from '@/i18n/context'

interface TiebreakEditorProps {
  // Identifiant du champ de saisie (cible du résumé d'erreurs).
  id: string
  value: string[]
  onChange: (value: string[]) => void
  describedBy?: string
  invalid?: boolean
}

// Critères de départage ordonnés : ajout, retrait et réordonnancement au clavier (boutons
// Monter / Descendre), chaque changement annoncé dans une région live ; le focus suit le critère
// déplacé.
export function TiebreakEditor({ id, value, onChange, describedBy, invalid }: TiebreakEditorProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  // Élément à cibler après le prochain rendu (la liste vient d'être réordonnée).
  const focusTarget = useRef<string | null>(null)

  useEffect(() => {
    if (!focusTarget.current) return
    document.getElementById(focusTarget.current)?.focus()
    focusTarget.current = null
  })

  const buttonId = (key: string, action: 'up' | 'down' | 'remove') => `${id}-${key}-${action}`

  function add() {
    const key = draft.trim()
    if (!validTiebreakKey(key)) return setDraftError(t('steps.tiebreakInvalid', { max: TIEBREAK_KEY_MAX }))
    if (value.includes(key)) return setDraftError(t('steps.tiebreakDuplicate'))
    if (value.length >= TIEBREAK_MAX) return setDraftError(t('steps.tiebreakFull', { max: TIEBREAK_MAX }))
    onChange([...value, key])
    setDraft('')
    setDraftError(null)
    setAnnouncement(t('steps.tiebreakAdded', { key, n: value.length + 1 }))
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= value.length) return
    const next = [...value]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
    const key = value[index]
    setAnnouncement(t('steps.tiebreakMoved', { key, n: target + 1 }))
    // Le bouton utilisé reste ciblé ; en bout de liste (bouton désactivé), l'autre sens prend le relais.
    const atEdge = delta === -1 ? target === 0 : target === value.length - 1
    focusTarget.current = buttonId(key, atEdge ? (delta === -1 ? 'down' : 'up') : delta === -1 ? 'up' : 'down')
  }

  function remove(index: number) {
    const key = value[index]
    const next = value.filter((_, i) => i !== index)
    onChange(next)
    setAnnouncement(t('steps.tiebreakRemoved', { key }))
    const neighbour = next[index] ?? next[index - 1]
    focusTarget.current = neighbour ? buttonId(neighbour, 'remove') : id
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      add()
    }
  }

  const errorId = `${id}-draft-error`

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor={id}>{t('steps.tiebreakNew')}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={id}
            value={draft}
            autoComplete="off"
            spellCheck={false}
            maxLength={TIEBREAK_KEY_MAX}
            placeholder="wins"
            className="min-w-0 flex-1 font-mono sm:max-w-xs"
            aria-invalid={draftError || invalid ? true : undefined}
            aria-describedby={[describedBy, draftError ? errorId : null].filter(Boolean).join(' ') || undefined}
            onChange={(event) => {
              setDraft(event.target.value)
              setDraftError(null)
            }}
            onKeyDown={onKeyDown}
          />
          <Button type="button" variant="outline" onClick={add} disabled={value.length >= TIEBREAK_MAX}>
            <Icon icon={Add01Icon} />
            {t('steps.tiebreakAdd')}
          </Button>
        </div>
        {draftError ? (
          <p id={errorId} className="text-sm text-destructive">
            <span className="font-medium">{t('common.error')}</span> {draftError}
          </p>
        ) : null}
      </div>

      {value.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">{t('steps.tiebreakEmpty')}</p>
      ) : (
        <ol aria-label={t('steps.tiebreakList')} className="grid gap-2">
          {value.map((key, index) => (
            <li
              key={key}
              className="flex flex-wrap items-center gap-3 rounded-xl bg-background/60 px-3 py-2 ring-1 ring-foreground/10 dark:bg-input/20"
            >
              <span
                className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 font-mono text-xs font-bold text-primary dark:bg-primary/25 dark:text-violet-200"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="sr-only">{t('steps.tiebreakPriority', { n: index + 1 })} : </span>
                <code className="font-mono text-sm font-semibold break-all">{key}</code>
              </span>
              <span className="flex gap-1">
                <Button
                  id={buttonId(key, 'up')}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('steps.tiebreakUp', { key })}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <Icon icon={ArrowUp01Icon} />
                </Button>
                <Button
                  id={buttonId(key, 'down')}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('steps.tiebreakDown', { key })}
                  disabled={index === value.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <Icon icon={ArrowDown01Icon} />
                </Button>
                <Button
                  id={buttonId(key, 'remove')}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('steps.tiebreakRemove', { key })}
                  onClick={() => remove(index)}
                >
                  <Icon icon={Cancel01Icon} />
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}
