import { Add01Icon, Cancel01Icon, FloppyDiskIcon } from '@hugeicons/core-free-icons'
import { useId, useRef, useState, type FormEvent } from 'react'

import { StateMessage } from '@/components/games/StateMessage'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setStatOptions } from '@/features/stats/api'
import { statErrorKey } from '@/features/stats/errors'
import { isValidOptionLabel, optionKey, OPTIONS_MAX, optionsProblem } from '@/features/stats/options'
import type { Stat, StatOption } from '@/features/stats/types'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

// Valeurs d'une statistique `select` pour un jeu (PUT /games/{id}/stats/{stat_id}/options,
// administrateur). Renommer garde la clé : les résultats déjà saisis restent valides. Une valeur
// retirée reste lisible dans les anciens résultats mais n'est plus proposée.
export function StatOptionsEditor({
  gameId,
  stat,
  onSaved,
  onCancel,
}: {
  gameId: string
  stat: Stat
  onSaved: (options: StatOption[]) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const { refreshRole } = useAuth()
  const id = useId()
  const [options, setOptions] = useState<StatOption[]>(stat.options ?? [])
  const [label, setLabel] = useState('')
  const [error, setError] = useState<MessageKey | null>(null)
  const [busy, setBusy] = useState(false)
  // Clés déjà attribuées (y compris retirées pendant cette édition) : jamais réutilisées pour
  // une autre valeur.
  const reserved = useRef((stat.options ?? []).map((option) => option.key))
  const pending = useRef(false)

  function add() {
    if (!isValidOptionLabel(label) || options.length >= OPTIONS_MAX) {
      setError('stats.validation.options')
      return
    }
    const key = optionKey(label, reserved.current)
    reserved.current.push(key)
    setOptions([...options, { key, label: label.trim() }])
    setLabel('')
    setError(null)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    if (label.trim() !== '') {
      setError('stats.addBeforeSave')
      return
    }
    const cleaned = options.map((option) => ({ ...option, label: option.label.trim() }))
    const problem = optionsProblem(cleaned)
    if (problem) {
      setError(problem)
      return
    }
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      onSaved(await setStatOptions(gameId, stat.id, cleaned))
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) void refreshRole()
      setError(statErrorKey(caught, 'options'))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} noValidate aria-busy={busy} aria-labelledby={`${id}-title`} className="grid gap-3 rounded-lg bg-muted/40 p-3">
      <div className="grid gap-1">
        <h3 id={`${id}-title`} className="text-sm font-semibold">
          {t('stats.optionsTitle', { name: stat.name })}
        </h3>
        <p className="text-sm text-muted-foreground">{t('stats.optionsHelp')}</p>
      </div>
      {error ? (
        <StateMessage kind="error">
          {t(error)}
        </StateMessage>
      ) : null}
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('stats.noOptions')}</p>
      ) : (
        <ol className="grid gap-2" aria-label={t('stats.optionsList', { name: stat.name })}>
          {options.map((option, index) => (
            <li key={option.key} className="flex flex-wrap items-center gap-2">
              <Input
                className="max-w-xs"
                aria-label={t('stats.optionLabel', { number: index + 1 })}
                value={option.label}
                maxLength={128}
                aria-invalid={!isValidOptionLabel(option.label) ? true : undefined}
                onChange={(event) =>
                  setOptions(options.map((current) => (current.key === option.key ? { ...current, label: event.target.value } : current)))
                }
              />
              <code className="text-xs text-muted-foreground">{option.key}</code>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('stats.removeOption', { name: option.label || option.key })}
                disabled={busy}
                onClick={() => setOptions(options.filter((current) => current.key !== option.key))}
              >
                <Icon icon={Cancel01Icon} />
              </Button>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">{t('stats.removeOptionHelp')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-new`}>{t('stats.newOption')}</Label>
          <Input
            id={`${id}-new`}
            className="max-w-xs"
            value={label}
            autoComplete="off"
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                add()
              }
            }}
          />
        </div>
        <Button type="button" variant="outline" disabled={busy} onClick={add}>
          <Icon icon={Add01Icon} />
          {t('stats.addOption')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          <Icon icon={FloppyDiskIcon} />
          {busy ? t('stats.savingOptions') : t('stats.saveOptions')}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
