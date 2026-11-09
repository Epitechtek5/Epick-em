import {
  FloppyDiskIcon,
  GridViewIcon,
  InformationCircleIcon,
  RankingIcon,
  Route01Icon,
} from '@hugeicons/core-free-icons'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { ErrorSummary, type ErrorSummaryItem } from '@/components/form/ErrorSummary'
import { FormSection } from '@/components/tournaments/ui'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDescKey, formatLabelKey, matchTypeDescKey, matchTypeLabelKey } from '@/features/steps/labels'
import {
  MATCH_TYPES,
  STEP_FORMATS,
  type Step,
  type StepField,
  type StepFieldErrors,
  type StepValues,
} from '@/features/steps/types'
import {
  GROUPS_MAX,
  MATCHES_MAX,
  POSITION_MAX,
  SIZE_MAX,
  TIEBREAK_MAX,
  validateStep,
} from '@/features/steps/validation'
import { useI18n, type MessageKey } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { TiebreakEditor } from './TiebreakEditor'

const IDS: Record<StepField, string> = {
  position: 'step-position',
  format: 'step-format-pool',
  match_type: 'step-match-duel',
  group_count: 'step-group-count',
  group_size: 'step-group-size',
  matches_per_group: 'step-matches',
  advance_per_group: 'step-advance',
  tiebreak: 'step-tiebreak',
}
const ORDER: StepField[] = [
  'position',
  'format',
  'match_type',
  'group_count',
  'group_size',
  'matches_per_group',
  'advance_per_group',
  'tiebreak',
]

interface StepFormProps {
  initial: StepValues
  // Autres étapes du tournoi (unicité de la position).
  others: readonly Step[]
  submitLabel: string
  busy: boolean
  serverErrors?: StepFieldErrors
  formError?: MessageKey | null
  onSubmit: (values: StepValues) => void
  onCancel: () => void
  // Aperçu en direct (chaînage), affiché à côté du formulaire sur grand écran.
  preview?: (values: StepValues) => ReactNode
}

const RADIO_CARD =
  'flex cursor-pointer items-start gap-3 rounded-xl p-4 ring-1 ring-foreground/15 transition-colors ring-inset hover:bg-muted/40 has-checked:bg-primary/5 has-checked:ring-2 has-checked:ring-primary has-focus-visible:outline-3 has-focus-visible:outline-ring/50 motion-reduce:transition-none dark:has-checked:bg-primary/15'

export function StepForm({ initial, others, submitLabel, busy, serverErrors, formError, onSubmit, onCancel, preview }: StepFormProps) {
  const { t } = useI18n()
  const summaryRef = useRef<HTMLDivElement>(null)
  const [values, setValues] = useState<StepValues>(initial)
  const [errors, setErrors] = useState<StepFieldErrors>({})
  const [focusSummary, setFocusSummary] = useState(0)

  useEffect(() => {
    if (focusSummary > 0) summaryRef.current?.focus()
  }, [focusSummary])

  // Une erreur renvoyée par le serveur ramène le focus sur le résumé.
  useEffect(() => {
    if ((serverErrors && Object.keys(serverErrors).length > 0) || formError) summaryRef.current?.focus()
  }, [serverErrors, formError])

  const set = <K extends StepField>(field: K, value: StepValues[K]) => setValues((current) => ({ ...current, [field]: value }))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const found = validateStep(values, others)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setFocusSummary((n) => n + 1)
      return
    }
    onSubmit(values)
  }

  const messages: Partial<Record<StepField, string>> = {}
  for (const field of ORDER) {
    const key = errors[field] ?? serverErrors?.[field]
    if (key) messages[field] = t(key)
  }
  const items: ErrorSummaryItem[] = [
    ...ORDER.flatMap((field) => (messages[field] ? [{ fieldId: IDS[field], message: messages[field] }] : [])),
    ...(formError ? [{ message: t(formError) }] : []),
  ]

  const describe = (field: StepField, ...hints: Array<string | false | undefined>) =>
    [...hints, messages[field] ? `${IDS[field]}-error` : null].filter(Boolean).join(' ') || undefined

  const fieldError = (field: StepField) =>
    messages[field] ? (
      <p id={`${IDS[field]}-error`} className="text-sm text-destructive">
        <span className="font-medium">{t('common.error')}</span> {messages[field]}
      </p>
    ) : null

  const hint = (id: string, text: ReactNode) => (
    <p id={id} className="text-sm text-muted-foreground">
      {text}
    </p>
  )

  const numberField = (field: 'position' | 'group_count' | 'group_size' | 'matches_per_group' | 'advance_per_group', label: string, min: number, max: number, hintText: string, disabled = false) => (
    <div className="grid gap-2">
      <Label htmlFor={IDS[field]}>{label}</Label>
      <Input
        id={IDS[field]}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={values[field]}
        required
        disabled={disabled}
        aria-invalid={messages[field] ? true : undefined}
        aria-describedby={describe(field, `${IDS[field]}-hint`)}
        onChange={(event) => set(field, event.target.value)}
      />
      {hint(`${IDS[field]}-hint`, hintText)}
      {fieldError(field)}
    </div>
  )

  const singleGroup = values.format !== 'pool'
  const groupSize = Number.parseInt(values.group_size, 10)

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={busy}
      className={cn('grid items-start gap-6', preview && 'lg:grid-cols-[minmax(0,1fr)_20rem]')}
    >
      <div className="grid min-w-0 gap-6">
        <ErrorSummary ref={summaryRef} items={items} title={t('steps.validation.fixErrors')} />
        <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <Icon icon={InformationCircleIcon} size={18} className="mt-0.5 shrink-0" />
          <span>{t('steps.formHint')}</span>
        </p>

        <FormSection icon={Route01Icon} title={t('steps.sections.general')}>
          <div className="sm:max-w-xs">
            {numberField('position', t('steps.positionLabel'), 1, POSITION_MAX, t('steps.positionHint', { max: POSITION_MAX }))}
          </div>

          <fieldset className="grid gap-2" aria-describedby="step-format-hint">
            <legend className="text-sm font-medium">{t('steps.formatLabel')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {STEP_FORMATS.map((format) => (
                <label key={format} className={RADIO_CARD}>
                  <input
                    id={`step-format-${format}`}
                    type="radio"
                    name="format"
                    value={format}
                    checked={values.format === format}
                    aria-labelledby={`step-format-${format}-label`}
                    aria-describedby={`step-format-${format}-desc`}
                    onChange={() =>
                      setValues((current) => ({
                        ...current,
                        format,
                        // Un seul groupe hors poules : le champ est forcé à 1.
                        group_count: format === 'pool' ? current.group_count : '1',
                      }))
                    }
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                  <span className="grid gap-1">
                    <span id={`step-format-${format}-label`} className="font-semibold">
                      {t(formatLabelKey(format))}
                    </span>
                    <span id={`step-format-${format}-desc`} className="text-sm text-muted-foreground">
                      {t(formatDescKey(format))}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {hint('step-format-hint', t('steps.formatHint'))}
          </fieldset>

          <fieldset className="grid gap-2" aria-describedby="step-match-hint">
            <legend className="text-sm font-medium">{t('steps.matchTypeLabel')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {MATCH_TYPES.map((type) => (
                <label key={type} className={RADIO_CARD}>
                  <input
                    id={`step-match-${type}`}
                    type="radio"
                    name="match_type"
                    value={type}
                    checked={values.match_type === type}
                    aria-labelledby={`step-match-${type}-label`}
                    aria-describedby={`step-match-${type}-desc`}
                    onChange={() => set('match_type', type)}
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                  <span className="grid gap-1">
                    <span id={`step-match-${type}-label`} className="font-semibold">
                      {t(matchTypeLabelKey(type))}
                    </span>
                    <span id={`step-match-${type}-desc`} className="text-sm text-muted-foreground">
                      {t(matchTypeDescKey(type))}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {hint('step-match-hint', t('steps.matchTypeHint'))}
          </fieldset>
        </FormSection>

        <FormSection icon={GridViewIcon} title={t('steps.sections.groups')}>
          <div className="grid gap-4 sm:grid-cols-2">
            {numberField(
              'group_count',
              t('steps.groupCount'),
              1,
              singleGroup ? 1 : GROUPS_MAX,
              singleGroup ? t('steps.singleGroupHint') : t('steps.groupCountHint', { max: GROUPS_MAX }),
              singleGroup,
            )}
            {numberField('group_size', t('steps.groupSize'), 2, SIZE_MAX, t('steps.groupSizeHint', { max: SIZE_MAX }))}
            {numberField('matches_per_group', t('steps.matchesPerGroup'), 1, MATCHES_MAX, t('steps.matchesHint', { max: MATCHES_MAX }))}
            {numberField(
              'advance_per_group',
              t('steps.advancePerGroup'),
              1,
              groupSize >= 2 ? groupSize : SIZE_MAX,
              t('steps.advanceHint'),
            )}
          </div>
        </FormSection>

        <FormSection
          icon={RankingIcon}
          title={t('steps.sections.tiebreak')}
          hint={hint('step-tiebreak-hint', t('steps.tiebreakHint', { max: TIEBREAK_MAX }))}
        >
          <TiebreakEditor
            id={IDS.tiebreak}
            value={values.tiebreak}
            onChange={(tiebreak) => set('tiebreak', tiebreak)}
            describedBy={describe('tiebreak', 'step-tiebreak-hint')}
            invalid={Boolean(messages.tiebreak)}
          />
          {fieldError('tiebreak')}
        </FormSection>

        <div className="flex flex-wrap justify-end gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            <Icon icon={FloppyDiskIcon} />
            {busy ? t('steps.saving') : submitLabel}
          </Button>
        </div>
      </div>

      {preview ? preview(values) : null}
    </form>
  )
}
