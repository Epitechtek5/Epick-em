import type { IconSvgElement } from '@hugeicons/react'
import { useState, type FormEvent } from 'react'

import { StateMessage } from '@/components/games/StateMessage'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { tournamentErrorKey } from '@/features/tournaments/errors'
import type { CopyInput, Tournament } from '@/features/tournaments/types'
import { fromLocalInput, NAME_MAX, toLocalInput } from '@/features/tournaments/validation'
import { useI18n, type MessageKey } from '@/i18n/context'

interface CopyTournamentDialogProps {
  // Tournoi ou modèle recopié (nom et dates proposés par défaut).
  source: Pick<Tournament, 'name' | 'start_date' | 'end_date'>
  idPrefix: string
  label: string
  title: string
  description: string
  submitLabel: string
  defaultName: string
  icon: IconSvgElement
  variant?: 'default' | 'outline'
  // Les dates ne sont pas proposées pour un modèle (il garde celles de la source).
  withDates?: boolean
  onCopy: (input: CopyInput) => Promise<unknown>
}

// Doublon, modèle ou tournoi depuis un modèle : nom (obligatoire, unique par jeu) et dates
// facultatives. Seule la configuration est recopiée, jamais les inscrits ni les résultats.
export function CopyTournamentDialog({
  source,
  idPrefix,
  label,
  title,
  description,
  submitLabel,
  defaultName,
  icon,
  variant = 'outline',
  withDates = true,
  onCopy,
}: CopyTournamentDialogProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(defaultName)
  const [start, setStart] = useState(toLocalInput(source.start_date))
  const [end, setEnd] = useState(toLocalInput(source.end_date))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)

  function reset() {
    setName(defaultName)
    setStart(toLocalInput(source.start_date))
    setEnd(toLocalInput(source.end_date))
    setError(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const trimmed = name.trim()
    const length = Array.from(trimmed).length
    if (length < 1 || length > NAME_MAX) {
      setError('tournaments.validation.name')
      return
    }
    const from = withDates ? fromLocalInput(start) : null
    const to = withDates ? fromLocalInput(end) : null
    if (withDates && (!from || !to)) {
      setError('tournaments.validation.date')
      return
    }
    if (from && to && to < from) {
      setError('tournaments.validation.endBeforeStart')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onCopy({ name: trimmed, ...(from ? { start_date: from } : {}), ...(to ? { end_date: to } : {}) })
      setOpen(false)
    } catch (caught) {
      setError(tournamentErrorKey(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) reset()
      }}
    >
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Icon icon={icon} />
        {label}
      </Button>
      <AlertDialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <StateMessage kind="error">{t(error, { max: NAME_MAX })}</StateMessage> : null}
          <div className="grid gap-1">
            <Label htmlFor={`${idPrefix}-name`}>{t('tournaments.name')}</Label>
            <Input
              id={`${idPrefix}-name`}
              value={name}
              required
              autoComplete="off"
              aria-invalid={error === 'tournaments.validation.name' || error === 'tournaments.errors.nameTaken' ? true : undefined}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {withDates ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor={`${idPrefix}-start`}>{t('tournaments.startDate')}</Label>
                <Input id={`${idPrefix}-start`} type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${idPrefix}-end`}>{t('tournaments.endDate')}</Label>
                <Input id={`${idPrefix}-end`} type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} />
              </div>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel type="button">{t('common.cancel')}</AlertDialogCancel>
            <Button type="submit" disabled={busy}>
              {busy ? t('tournaments.saving') : submitLabel}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
