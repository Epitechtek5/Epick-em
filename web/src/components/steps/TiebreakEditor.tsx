import { Add01Icon, ArrowDown01Icon, ArrowUp01Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { tiebreakDescKey, tiebreakLabel } from '@/features/steps/labels'
import { TIEBREAK_CRITERIA } from '@/features/steps/types'
import { isSupportedCriterion, TIEBREAK_MAX } from '@/features/steps/validation'
import { useI18n } from '@/i18n/context'

interface TiebreakEditorProps {
  // Identifiant de la liste de choix (cible du résumé d'erreurs).
  id: string
  value: string[]
  onChange: (value: string[]) => void
  describedBy?: string
  invalid?: boolean
}

// Critères de départage ordonnés, choisis parmi ceux que le serveur évalue (confrontation directe,
// différentiel de manches, Buchholz) : ajout, retrait et réordonnancement au clavier (boutons
// Monter / Descendre), chaque changement annoncé dans une région live ; le focus suit le critère
// déplacé. Une clé historique non évaluée reste affichée, signalée, et peut être retirée.
export function TiebreakEditor({ id, value, onChange, describedBy, invalid }: TiebreakEditorProps) {
  const { t } = useI18n()
  const available = TIEBREAK_CRITERIA.filter((criterion) => !value.includes(criterion))
  const [draft, setDraft] = useState<string>('')
  const [announcement, setAnnouncement] = useState('')
  // Élément à cibler après le prochain rendu (la liste vient d'être réordonnée).
  const focusTarget = useRef<string | null>(null)
  const choice = available.includes(draft as (typeof available)[number]) ? draft : (available[0] ?? '')

  useEffect(() => {
    if (!focusTarget.current) return
    document.getElementById(focusTarget.current)?.focus()
    focusTarget.current = null
  })

  const buttonId = (key: string, action: 'up' | 'down' | 'remove') => `${id}-${key}-${action}`
  const label = (key: string) => tiebreakLabel(t, key)

  function add() {
    if (!choice || value.length >= TIEBREAK_MAX) return
    onChange([...value, choice])
    setDraft('')
    setAnnouncement(t('steps.tiebreakAdded', { key: label(choice), n: value.length + 1 }))
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= value.length) return
    const next = [...value]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
    const key = value[index]
    setAnnouncement(t('steps.tiebreakMoved', { key: label(key), n: target + 1 }))
    // Le bouton utilisé reste ciblé ; en bout de liste (bouton désactivé), l'autre sens prend le relais.
    const atEdge = delta === -1 ? target === 0 : target === value.length - 1
    focusTarget.current = buttonId(key, atEdge ? (delta === -1 ? 'down' : 'up') : delta === -1 ? 'up' : 'down')
  }

  function remove(index: number) {
    const key = value[index]
    const next = value.filter((_, i) => i !== index)
    onChange(next)
    setAnnouncement(t('steps.tiebreakRemoved', { key: label(key) }))
    const neighbour = next[index] ?? next[index - 1]
    focusTarget.current = neighbour ? buttonId(neighbour, 'remove') : id
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor={id}>{t('steps.tiebreakNew')}</Label>
        <div className="flex flex-wrap gap-2">
          <NativeSelect
            id={id}
            value={choice}
            disabled={available.length === 0}
            className="h-9 min-w-0 flex-1 sm:max-w-xs"
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => setDraft(event.target.value)}
          >
            {available.length === 0 ? <option value="">{t('steps.tiebreakAllChosen')}</option> : null}
            {available.map((criterion) => (
              <option key={criterion} value={criterion}>
                {label(criterion)}
              </option>
            ))}
          </NativeSelect>
          <Button type="button" variant="outline" onClick={add} disabled={!choice || value.length >= TIEBREAK_MAX}>
            <Icon icon={Add01Icon} />
            {t('steps.tiebreakAdd')}
          </Button>
        </div>
        {choice ? <p className="text-sm text-muted-foreground">{t(tiebreakDescKey(choice as (typeof available)[number]))}</p> : null}
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
              <span className="grid min-w-0 flex-1">
                <span>
                  <span className="sr-only">{t('steps.tiebreakPriority', { n: index + 1 })}{t('common.colon')} </span>
                  <span className="font-semibold">{label(key)}</span>
                </span>
                {isSupportedCriterion(key) ? null : (
                  <span className="text-xs text-amber-800 dark:text-amber-200">{t('steps.tiebreakLegacy')}</span>
                )}
              </span>
              <span className="flex gap-1">
                <Button
                  id={buttonId(key, 'up')}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('steps.tiebreakUp', { key: label(key) })}
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
                  aria-label={t('steps.tiebreakDown', { key: label(key) })}
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
                  aria-label={t('steps.tiebreakRemove', { key: label(key) })}
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
