import { useEffect, useRef, useState, type FormEvent } from 'react'

import { ErrorSummary, type ErrorSummaryItem } from '@/components/form/ErrorSummary'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { STAT_TYPES, type StatField, type StatFieldErrors, type StatInput } from '@/features/stats/types'
import { validateStat } from '@/features/stats/validation'
import { useI18n, type MessageKey } from '@/i18n/context'

const EMPTY_VALUES: StatInput = { name: '', key: '', type: 'flat' }

const IDS: Record<StatField, string> = {
  name: 'stat-name',
  key: 'stat-key',
  type: 'stat-type',
}

interface StatFormProps {
  initial?: StatInput
  submitLabel: string
  busy: boolean
  // Erreurs renvoyées par le serveur (ex. 409 sur la clé) et message global.
  serverErrors?: Partial<Record<StatField, MessageKey>>
  formError?: MessageKey | null
  onSubmit: (values: StatInput) => void
  onCancel: () => void
}

export function StatForm({
  initial = EMPTY_VALUES,
  submitLabel,
  busy,
  serverErrors,
  formError,
  onSubmit,
  onCancel,
}: StatFormProps) {
  const { t } = useI18n()
  const summaryRef = useRef<HTMLDivElement>(null)
  const focusSummary = useRef(false)
  const [values, setValues] = useState<StatInput>(initial)
  const [errors, setErrors] = useState<StatFieldErrors>({})

  // Focus demandé après un envoi refusé : appliqué après le rendu du résumé d'erreurs.
  useEffect(() => {
    if (!focusSummary.current) return
    focusSummary.current = false
    summaryRef.current?.focus()
  })

  // Une erreur renvoyée par le serveur ramène le focus sur le résumé.
  useEffect(() => {
    if ((serverErrors && Object.keys(serverErrors).length > 0) || formError) {
      summaryRef.current?.focus()
    }
  }, [serverErrors, formError])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const found = validateStat(values)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      focusSummary.current = true
      return
    }
    onSubmit(values)
  }

  const messages: Partial<Record<StatField, string>> = {}
  for (const field of Object.keys(IDS) as StatField[]) {
    const key = errors[field] ?? serverErrors?.[field]
    if (key) messages[field] = t(key)
  }
  const items: ErrorSummaryItem[] = [
    ...(Object.keys(IDS) as StatField[]).flatMap((field) =>
      messages[field] ? [{ fieldId: IDS[field], message: messages[field] }] : [],
    ),
    ...(formError ? [{ message: t(formError) }] : []),
  ]

  const describe = (field: StatField, extra?: string) =>
    [extra, messages[field] ? `${IDS[field]}-error` : null].filter(Boolean).join(' ') || undefined

  const fieldError = (field: StatField) =>
    messages[field] ? (
      <p id={`${IDS[field]}-error`} className="text-sm text-destructive">
        <span className="font-medium">{t('common.error')}</span> {messages[field]}
      </p>
    ) : null

  return (
    <form onSubmit={submit} noValidate aria-busy={busy} className="grid gap-6">
      <ErrorSummary ref={summaryRef} items={items} title={t('stats.validation.fixErrors')} />
      <p className="text-sm text-muted-foreground">{t('stats.formHint')}</p>

      <div className="grid gap-2">
        <Label htmlFor={IDS.name}>{t('stats.name')}</Label>
        <Input
          id={IDS.name}
          value={values.name}
          required
          autoComplete="off"
          aria-invalid={messages.name ? true : undefined}
          aria-describedby={describe('name')}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
        />
        {fieldError('name')}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={IDS.key}>{t('stats.key')}</Label>
        <Input
          id={IDS.key}
          value={values.key}
          required
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="font-mono"
          aria-invalid={messages.key ? true : undefined}
          aria-describedby={describe('key', 'stat-key-hint')}
          onChange={(event) => setValues({ ...values, key: event.target.value })}
        />
        <p id="stat-key-hint" className="text-sm text-muted-foreground">
          {t('stats.keyHint')}
        </p>
        {fieldError('key')}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={IDS.type}>{t('stats.type')}</Label>
        <select
          id={IDS.type}
          value={values.type}
          aria-invalid={messages.type ? true : undefined}
          aria-describedby={describe('type')}
          onChange={(event) =>
            setValues({ ...values, type: event.target.value as StatInput['type'] })
          }
          className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30"
        >
          {STAT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type === 'flat' ? t('stats.typeFlat') : t('stats.typePercent')} ({type})
            </option>
          ))}
        </select>
        {fieldError('type')}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? t('stats.saving') : submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
