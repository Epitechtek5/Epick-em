import { Calendar03Icon, FloppyDiskIcon, HierarchyIcon, InformationCircleIcon, UserMultipleIcon } from '@hugeicons/core-free-icons'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { ErrorSummary, type ErrorSummaryItem } from '@/components/form/ErrorSummary'
import { FormSection } from '@/components/tournaments/ui'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { bracketLabelKey } from '@/features/matches/labels'
import { BRACKETS, type Match, type MatchField, type MatchFieldErrors, type MatchValues } from '@/features/matches/types'
import {
  bracketAllowed,
  canEditParticipants,
  isElimination,
  matchCapacity,
  nextCandidates,
  ROUND_MAX,
  validateMatch,
} from '@/features/matches/validation'
import type { GroupRanking, Step } from '@/features/steps/types'
import type { Identity } from '@/hooks/use-participant-identities'
import { useI18n, type MessageKey } from '@/i18n/context'

const IDS: Record<MatchField, string> = {
  group_id: 'match-group',
  participant_ids: 'match-participants',
  round: 'match-round',
  bracket: 'match-bracket',
  next_match_id: 'match-next',
  scheduled_at: 'match-scheduled-at',
}
const ORDER: MatchField[] = ['group_id', 'participant_ids', 'round', 'bracket', 'next_match_id', 'scheduled_at']

interface MatchFormProps {
  initial: MatchValues
  step: Step
  groups: readonly GroupRanking[]
  // Tous les matchs de l'étape (match suivant).
  matches: readonly Match[]
  // Match modifié (null en création).
  current: Match | null
  numbers: Map<string, number>
  identity: (participantId: string) => Identity
  submitLabel: string
  busy: boolean
  serverErrors?: MatchFieldErrors
  formError?: MessageKey | null
  formDetail?: string
  onSubmit: (values: MatchValues) => void
  onCancel: () => void
}

// Formulaire de match (création et modification), validé comme le serveur avant l'envoi.
export function MatchForm({
  initial,
  step,
  groups,
  matches,
  current,
  numbers,
  identity,
  submitLabel,
  busy,
  serverErrors,
  formError,
  formDetail,
  onSubmit,
  onCancel,
}: MatchFormProps) {
  const { t } = useI18n()
  const summaryRef = useRef<HTMLDivElement>(null)
  const [values, setValues] = useState<MatchValues>(initial)
  const [errors, setErrors] = useState<MatchFieldErrors>({})
  const [focusSummary, setFocusSummary] = useState(0)

  useEffect(() => {
    if (focusSummary > 0) summaryRef.current?.focus()
  }, [focusSummary])
  useEffect(() => {
    if ((serverErrors && Object.keys(serverErrors).length > 0) || formError) summaryRef.current?.focus()
  }, [serverErrors, formError])

  const set = <K extends MatchField>(field: K, value: MatchValues[K]) => setValues((previous) => ({ ...previous, [field]: value }))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const found = validateMatch(values, { step, groups, matches, current })
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setFocusSummary((n) => n + 1)
      return
    }
    onSubmit(values)
  }

  const capacity = matchCapacity(step)
  const messages: Partial<Record<MatchField, string>> = {}
  for (const field of ORDER) {
    const key = errors[field] ?? serverErrors?.[field]
    if (key) messages[field] = t(key, { max: capacity, rounds: ROUND_MAX })
  }
  const items: ErrorSummaryItem[] = [
    ...ORDER.flatMap((field) => (messages[field] ? [{ fieldId: IDS[field], message: messages[field] }] : [])),
    ...(formError ? [{ message: formDetail ? `${t(formError)} ${formDetail}` : t(formError) }] : []),
  ]
  const describe = (field: MatchField, ...hints: string[]) =>
    [...hints, messages[field] ? `${IDS[field]}-error` : null].filter(Boolean).join(' ') || undefined
  const fieldError = (field: MatchField) =>
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

  const group = groups.find((candidate) => candidate.group_id === values.group_id)
  const lockedParticipants = current !== null && !canEditParticipants(current)
  const candidates = nextCandidates(step, matches, current)
  const label = (match: Match) => t('matches.number', { number: numbers.get(match.id) ?? 0 })

  return (
    <form onSubmit={submit} noValidate aria-busy={busy} className="grid gap-6">
      <ErrorSummary ref={summaryRef} items={items} title={t('matches.validation.fixErrors')} />
      <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <Icon icon={InformationCircleIcon} size={18} className="mt-0.5 shrink-0" />
        <span>{t('matches.formHint')}</span>
      </p>

      <FormSection icon={UserMultipleIcon} title={t('matches.sections.participants')}>
        <div className="grid gap-2 sm:max-w-sm">
          <Label htmlFor={IDS.group_id}>{t('matches.groupLabel')}</Label>
          {current ? (
            <p id={IDS.group_id} className="text-sm font-medium">
              {group ? t('matches.groupNumber', { index: group.index }) : t('matches.unknownGroup')}
              <span className="block font-normal text-muted-foreground">{t('matches.groupFixed')}</span>
            </p>
          ) : (
            <NativeSelect
              id={IDS.group_id}
              value={values.group_id}
              required
              aria-invalid={messages.group_id ? true : undefined}
              aria-describedby={describe('group_id')}
              onChange={(event) => setValues((previous) => ({ ...previous, group_id: event.target.value, participant_ids: [] }))}
            >
              <option value="">{t('matches.chooseGroup')}</option>
              {groups.map((candidate) => (
                <option key={candidate.group_id} value={candidate.group_id}>
                  {t('matches.groupNumber', { index: candidate.index })}
                </option>
              ))}
            </NativeSelect>
          )}
          {fieldError('group_id')}
        </div>

        <fieldset id={IDS.participant_ids} tabIndex={-1} className="grid gap-2" aria-describedby={describe('participant_ids', 'match-participants-hint')}>
          <legend className="text-sm font-medium">{t('matches.participants')}</legend>
          {hint(
            'match-participants-hint',
            <>
              {t(step.match_type === 'duel' ? 'matches.duelHint' : 'matches.ffaHint', { max: capacity })}{' '}
              {isElimination(step) ? t('matches.emptyAllowed') : null}{' '}
              {lockedParticipants ? t('matches.participantsLocked') : null}
            </>,
          )}
          {!group ? (
            <p className="text-sm text-muted-foreground">{t('matches.chooseGroupFirst')}</p>
          ) : group.participants.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('matches.groupEmpty')}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {group.participants.map((member) => {
                const checked = values.participant_ids.includes(member.participant_id)
                const who = identity(member.participant_id)
                return (
                  <li key={member.participant_id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg p-2 ring-1 ring-foreground/10 ring-inset hover:bg-muted/40 has-checked:bg-primary/5 has-checked:ring-primary has-disabled:cursor-not-allowed has-disabled:opacity-60 dark:has-checked:bg-primary/15">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={checked}
                        disabled={lockedParticipants}
                        aria-invalid={messages.participant_ids ? true : undefined}
                        onChange={() =>
                          set(
                            'participant_ids',
                            checked
                              ? values.participant_ids.filter((id) => id !== member.participant_id)
                              : [...values.participant_ids, member.participant_id],
                          )
                        }
                      />
                      <span className="grid min-w-0">
                        <span className="truncate font-medium">{who.name}</span>
                        {who.detail ? <span className="truncate text-xs text-muted-foreground">{who.detail}</span> : null}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          <p role="status" className="text-sm text-muted-foreground">
            {t('matches.selectedCount', { count: values.participant_ids.length, max: capacity })}
          </p>
          {fieldError('participant_ids')}
        </fieldset>
      </FormSection>

      <FormSection icon={HierarchyIcon} title={t('matches.sections.placement')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor={IDS.round}>{t('matches.round')}</Label>
            <Input
              id={IDS.round}
              type="number"
              inputMode="numeric"
              min={1}
              max={ROUND_MAX}
              step={1}
              value={values.round}
              aria-invalid={messages.round ? true : undefined}
              aria-describedby={describe('round', 'match-round-hint')}
              onChange={(event) => set('round', event.target.value)}
            />
            {hint('match-round-hint', t('matches.roundHint', { max: ROUND_MAX }))}
            {fieldError('round')}
          </div>

          {bracketAllowed(step) || values.bracket ? (
            <div className="grid gap-2">
              <Label htmlFor={IDS.bracket}>{t('matches.bracketLabel')}</Label>
              <NativeSelect
                id={IDS.bracket}
                value={values.bracket}
                aria-invalid={messages.bracket ? true : undefined}
                aria-describedby={describe('bracket', 'match-bracket-hint')}
                onChange={(event) => set('bracket', event.target.value as MatchValues['bracket'])}
              >
                <option value="">{t('matches.bracket.none')}</option>
                {BRACKETS.map((value) => (
                  <option key={value} value={value}>
                    {t(bracketLabelKey(value))}
                  </option>
                ))}
              </NativeSelect>
              {hint('match-bracket-hint', t('matches.bracketFieldHint'))}
              {fieldError('bracket')}
            </div>
          ) : null}

          {isElimination(step) || values.next_match_id ? (
            <div className="grid gap-2">
              <Label htmlFor={IDS.next_match_id}>{t('matches.next')}</Label>
              <NativeSelect
                id={IDS.next_match_id}
                value={values.next_match_id}
                aria-invalid={messages.next_match_id ? true : undefined}
                aria-describedby={describe('next_match_id', 'match-next-hint')}
                onChange={(event) => set('next_match_id', event.target.value)}
              >
                <option value="">{t('matches.noNext')}</option>
                {values.next_match_id && !candidates.some((match) => match.id === values.next_match_id) ? (
                  <option value={values.next_match_id}>{t('matches.nextUnavailable')}</option>
                ) : null}
                {candidates.map((match) => (
                  <option key={match.id} value={match.id}>
                    {label(match)}
                    {match.round !== null ? ` · ${t('matches.roundNumber', { round: match.round })}` : ''}
                    {match.bracket ? ` · ${t(bracketLabelKey(match.bracket))}` : ''}
                  </option>
                ))}
              </NativeSelect>
              {hint('match-next-hint', t('matches.nextHint'))}
              {fieldError('next_match_id')}
            </div>
          ) : null}
        </div>
      </FormSection>

      <FormSection icon={Calendar03Icon} title={t('matches.sections.schedule')}>
        <div className="grid gap-2 sm:max-w-sm">
          <Label htmlFor={IDS.scheduled_at}>{t('matches.scheduledAt')}</Label>
          <Input
            id={IDS.scheduled_at}
            type="datetime-local"
            value={values.scheduled_at}
            aria-invalid={messages.scheduled_at ? true : undefined}
            aria-describedby={describe('scheduled_at', 'match-scheduled-hint')}
            onChange={(event) => set('scheduled_at', event.target.value)}
          />
          {hint('match-scheduled-hint', t('matches.scheduledHint'))}
          {fieldError('scheduled_at')}
        </div>
      </FormSection>

      <div className="flex flex-wrap justify-end gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          <Icon icon={FloppyDiskIcon} />
          {busy ? t('matches.saving') : submitLabel}
        </Button>
      </div>
    </form>
  )
}
