import {
  Calendar03Icon,
  FloppyDiskIcon,
  InformationCircleIcon,
  LockedIcon,
  UserGroupIcon,
  UserIcon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { ErrorSummary, type ErrorSummaryItem } from '@/components/form/ErrorSummary'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Textarea } from '@/components/ui/textarea'
import type { Game } from '@/features/games/types'
import { participantTypeLabelKey, teamScoringLabelKey } from '@/features/tournaments/labels'
import {
  PARTICIPANT_TYPES,
  TEAM_SCORING_MODES,
  type TeamScoringMode,
  type TournamentField,
  type TournamentFieldErrors,
  type TournamentValues,
} from '@/features/tournaments/types'
import {
  CAPACITY_MAX,
  DESCRIPTION_MAX,
  EMPTY_TOURNAMENT,
  TEAM_SIZE_MAX,
  validateTournament,
} from '@/features/tournaments/validation'
import { useI18n, type MessageKey } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { FormSection } from './ui'

const IDS: Record<TournamentField, string> = {
  game_id: 'tournament-game',
  name: 'tournament-name',
  description: 'tournament-description',
  start_date: 'tournament-start',
  end_date: 'tournament-end',
  registration_open_at: 'tournament-registration-open',
  registration_close_at: 'tournament-registration-close',
  participant_type: 'tournament-type-solo',
  team_size: 'tournament-team-size',
  max_participants: 'tournament-capacity',
  team_scoring_mode: 'tournament-team-scoring',
  team_scoring_n: 'tournament-team-scoring-n',
}
const ORDER: TournamentField[] = [
  'game_id',
  'name',
  'description',
  'start_date',
  'end_date',
  'registration_open_at',
  'registration_close_at',
  'participant_type',
  'team_size',
  'max_participants',
  'team_scoring_mode',
  'team_scoring_n',
]

interface TournamentFormProps {
  initial?: TournamentValues
  // Création : liste des jeux (le jeu et le type de participant ne se changent plus ensuite).
  games?: Game[]
  // Tournoi en cours ou terminé : capacité, taille d'équipe et score d'équipe verrouillés.
  capacityLocked?: boolean
  submitLabel: string
  busy: boolean
  serverErrors?: TournamentFieldErrors
  formError?: MessageKey | null
  onSubmit: (values: TournamentValues) => void
  onCancel: () => void
  // Aperçu en direct, affiché à côté du formulaire sur grand écran.
  preview?: (values: TournamentValues) => ReactNode
}

const TYPE_ICONS = { solo: UserIcon, team: UserGroupIcon } as const

export function TournamentForm({
  initial = EMPTY_TOURNAMENT,
  games,
  capacityLocked = false,
  submitLabel,
  busy,
  serverErrors,
  formError,
  onSubmit,
  onCancel,
  preview,
}: TournamentFormProps) {
  const { t } = useI18n()
  const creating = games !== undefined
  const summaryRef = useRef<HTMLDivElement>(null)
  const [values, setValues] = useState<TournamentValues>(initial)
  const [errors, setErrors] = useState<TournamentFieldErrors>({})
  const [focusSummary, setFocusSummary] = useState(0)

  useEffect(() => {
    if (focusSummary > 0) summaryRef.current?.focus()
  }, [focusSummary])

  // Une erreur renvoyée par le serveur ramène le focus sur le résumé.
  useEffect(() => {
    if ((serverErrors && Object.keys(serverErrors).length > 0) || formError) summaryRef.current?.focus()
  }, [serverErrors, formError])

  const set = <K extends TournamentField>(field: K, value: TournamentValues[K]) =>
    setValues((current) => ({ ...current, [field]: value }))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const found = validateTournament(values, creating)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setFocusSummary((n) => n + 1)
      return
    }
    onSubmit(values)
  }

  const messages: Partial<Record<TournamentField, string>> = {}
  for (const field of ORDER) {
    const key = errors[field] ?? serverErrors?.[field]
    if (key) messages[field] = t(key, { max: field === 'max_participants' ? CAPACITY_MAX : TEAM_SIZE_MAX })
  }
  const items: ErrorSummaryItem[] = [
    ...ORDER.flatMap((field) => (messages[field] ? [{ fieldId: IDS[field], message: messages[field] }] : [])),
    ...(formError ? [{ message: t(formError) }] : []),
  ]

  const describe = (field: TournamentField, ...hints: Array<string | false | undefined>) =>
    [...hints, messages[field] ? `${IDS[field]}-error` : null].filter(Boolean).join(' ') || undefined

  const fieldError = (field: TournamentField) =>
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

  const dateField = (field: 'start_date' | 'end_date' | 'registration_open_at' | 'registration_close_at', label: string, required: boolean) => (
    <div className="grid gap-2">
      <Label htmlFor={IDS[field]}>{label}</Label>
      <Input
        id={IDS[field]}
        type="datetime-local"
        value={values[field]}
        required={required}
        aria-invalid={messages[field] ? true : undefined}
        aria-describedby={describe(field, 'tournament-dates-hint')}
        onChange={(event) => set(field, event.target.value)}
      />
      {fieldError(field)}
    </div>
  )

  const lockedHint = capacityLocked ? 'tournament-locked-hint' : undefined

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={busy}
      className={cn('grid items-start gap-6', preview && 'lg:grid-cols-[minmax(0,1fr)_20rem]')}
    >
      <div className="grid min-w-0 gap-6">
        <ErrorSummary ref={summaryRef} items={items} title={t('tournaments.validation.fixErrors')} />
        <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <Icon icon={InformationCircleIcon} size={18} className="mt-0.5 shrink-0" />
          <span>
            {t('tournaments.formHint')}
            {creating ? '' : ` ${t('tournaments.clearHint')}`}
          </span>
        </p>

        <FormSection icon={InformationCircleIcon} title={t('tournaments.sections.general')}>
          {creating ? (
            <div className="grid gap-2">
              <Label htmlFor={IDS.game_id}>{t('tournaments.game')}</Label>
              <SearchableSelect
                id={IDS.game_id}
                options={games.map((game) => ({ value: game.id, label: game.name }))}
                value={values.game_id}
                onChange={(value) => set('game_id', value)}
                placeholder={t('tournaments.chooseGame')}
                noResultsLabel={t('common.noResults')}
                required
                aria-invalid={messages.game_id ? true : undefined}
                aria-describedby={describe('game_id', 'tournament-game-hint')}
              />
              {hint('tournament-game-hint', t('tournaments.gameHint'))}
              {fieldError('game_id')}
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor={IDS.name}>{t('tournaments.name')}</Label>
            <Input
              id={IDS.name}
              value={values.name}
              required
              autoComplete="off"
              aria-invalid={messages.name ? true : undefined}
              aria-describedby={describe('name', 'tournament-name-hint')}
              onChange={(event) => set('name', event.target.value)}
            />
            {hint('tournament-name-hint', t('tournaments.nameHint'))}
            {fieldError('name')}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={IDS.description}>{t('tournaments.descriptionOptional')}</Label>
            <Textarea
              id={IDS.description}
              value={values.description}
              aria-invalid={messages.description ? true : undefined}
              aria-describedby={describe('description', 'tournament-description-count')}
              onChange={(event) => set('description', event.target.value)}
            />
            {hint(
              'tournament-description-count',
              t('tournaments.descriptionCount', { count: Array.from(values.description.trim()).length, max: DESCRIPTION_MAX }),
            )}
            {fieldError('description')}
          </div>
        </FormSection>

        <FormSection
          icon={Calendar03Icon}
          title={t('tournaments.sections.dates')}
          hint={hint('tournament-dates-hint', t('tournaments.datesHint'))}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {dateField('start_date', t('tournaments.startDate'), true)}
            {dateField('end_date', t('tournaments.endDate'), true)}
          </div>
          <div className="grid gap-4 rounded-xl bg-muted/40 p-4 sm:grid-cols-2">
            <p className="text-sm font-medium sm:col-span-2">{t('tournaments.registrationWindow')}</p>
            {dateField('registration_open_at', t('tournaments.registrationOpenOptional'), false)}
            {dateField('registration_close_at', t('tournaments.registrationCloseOptional'), false)}
          </div>
        </FormSection>

        <FormSection icon={UserMultipleIcon} title={t('tournaments.sections.participants')}>
          {capacityLocked ? (
            <p id="tournament-locked-hint" className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-500/30 ring-inset dark:bg-amber-500/15 dark:text-amber-50">
              <Icon icon={LockedIcon} size={18} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
              {t('tournaments.capacityLockedHint')}
            </p>
          ) : null}

          <fieldset className="grid gap-2" aria-describedby="tournament-type-hint">
            <legend className="text-sm font-medium">{t('tournaments.participantTypeLabel')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {PARTICIPANT_TYPES.map((type) => (
                <label
                  key={type}
                  className="flex cursor-pointer items-start gap-3 rounded-xl p-4 ring-1 ring-foreground/15 transition-colors ring-inset hover:bg-muted/40 has-checked:bg-primary/5 has-checked:ring-2 has-checked:ring-primary has-disabled:cursor-not-allowed has-disabled:opacity-70 has-focus-visible:outline-3 has-focus-visible:outline-ring/50 motion-reduce:transition-none dark:has-checked:bg-primary/15"
                >
                  <input
                    id={`tournament-type-${type}`}
                    type="radio"
                    name="participant_type"
                    value={type}
                    checked={values.participant_type === type}
                    disabled={!creating}
                    aria-labelledby={`tournament-type-${type}-label`}
                    aria-describedby={`tournament-type-${type}-desc`}
                    onChange={() =>
                      setValues((current) => ({
                        ...current,
                        participant_type: type,
                        team_size: type === 'team' ? current.team_size : '',
                      }))
                    }
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                  <span className="grid gap-1">
                    <span id={`tournament-type-${type}-label`} className="flex items-center gap-2 font-semibold">
                      <Icon icon={TYPE_ICONS[type]} size={18} className="text-primary dark:text-violet-300" />
                      {t(participantTypeLabelKey(type))}
                    </span>
                    <span id={`tournament-type-${type}-desc`} className="text-sm text-muted-foreground">
                      {t(type === 'team' ? 'tournaments.participantTypeDesc.team' : 'tournaments.participantTypeDesc.solo')}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {hint('tournament-type-hint', creating ? t('tournaments.participantTypeHint') : t('tournaments.participantTypeFixed'))}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            {values.participant_type === 'team' ? (
              <div className="grid gap-2">
                <Label htmlFor={IDS.team_size}>{t('tournaments.teamSize')}</Label>
                <Input
                  id={IDS.team_size}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={TEAM_SIZE_MAX}
                  step={1}
                  value={values.team_size}
                  required
                  disabled={capacityLocked}
                  aria-invalid={messages.team_size ? true : undefined}
                  aria-describedby={describe('team_size', 'tournament-team-size-hint', lockedHint)}
                  onChange={(event) => set('team_size', event.target.value)}
                />
                {hint('tournament-team-size-hint', t('tournaments.teamSizeHint', { max: TEAM_SIZE_MAX }))}
                {fieldError('team_size')}
              </div>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor={IDS.max_participants}>{t('tournaments.capacity')}</Label>
              <Input
                id={IDS.max_participants}
                type="number"
                inputMode="numeric"
                min={1}
                max={CAPACITY_MAX}
                step={1}
                value={values.max_participants}
                required
                disabled={capacityLocked}
                aria-invalid={messages.max_participants ? true : undefined}
                aria-describedby={describe('max_participants', 'tournament-capacity-hint', lockedHint)}
                onChange={(event) => set('max_participants', event.target.value)}
              />
              {hint(
                'tournament-capacity-hint',
                t(values.participant_type === 'team' ? 'tournaments.capacityHintTeam' : 'tournaments.capacityHintSolo', {
                  max: CAPACITY_MAX,
                }),
              )}
              {fieldError('max_participants')}
            </div>

            <div className="grid gap-2">
              <Label htmlFor={IDS.team_scoring_mode}>{t('tournaments.teamScoringLabel')}</Label>
              <NativeSelect
                id={IDS.team_scoring_mode}
                value={values.team_scoring_mode}
                disabled={capacityLocked}
                aria-describedby={describe('team_scoring_mode', 'tournament-team-scoring-hint', lockedHint)}
                onChange={(event) => {
                  const mode = event.target.value as TeamScoringMode
                  setValues((current) => ({
                    ...current,
                    team_scoring_mode: mode,
                    team_scoring_n: mode === 'top_n' ? current.team_scoring_n : '',
                  }))
                }}
              >
                {TEAM_SCORING_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(teamScoringLabelKey(mode))}
                  </option>
                ))}
              </NativeSelect>
              {hint('tournament-team-scoring-hint', t('tournaments.teamScoringHint'))}
            </div>

            {values.team_scoring_mode === 'top_n' ? (
              <div className="grid gap-2">
                <Label htmlFor={IDS.team_scoring_n}>{t('tournaments.teamScoringN')}</Label>
                <Input
                  id={IDS.team_scoring_n}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={TEAM_SIZE_MAX}
                  step={1}
                  value={values.team_scoring_n}
                  required
                  disabled={capacityLocked}
                  aria-invalid={messages.team_scoring_n ? true : undefined}
                  aria-describedby={describe('team_scoring_n', 'tournament-team-scoring-n-hint', lockedHint)}
                  onChange={(event) => set('team_scoring_n', event.target.value)}
                />
                {hint('tournament-team-scoring-n-hint', t('tournaments.teamScoringNHint', { max: TEAM_SIZE_MAX }))}
                {fieldError('team_scoring_n')}
              </div>
            ) : null}
          </div>
        </FormSection>

        <div className="flex flex-wrap justify-end gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            <Icon icon={FloppyDiskIcon} />
            {busy ? t('tournaments.saving') : submitLabel}
          </Button>
        </div>
      </div>

      {preview ? preview(values) : null}
    </form>
  )
}
