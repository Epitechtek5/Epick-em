import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { ErrorSummary, type ErrorSummaryItem } from '@/components/form/ErrorSummary'
import { Button } from '@/components/ui/button'
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
}

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
    <form onSubmit={submit} noValidate aria-busy={busy} className="grid gap-6">
      <ErrorSummary ref={summaryRef} items={items} title={t('tournaments.validation.fixErrors')} />
      <p className="text-sm text-muted-foreground">
        {t('tournaments.formHint')}
        {creating ? '' : ` ${t('tournaments.clearHint')}`}
      </p>

      <fieldset className="grid gap-4">
        <legend className="mb-2 text-lg font-semibold">{t('tournaments.sections.general')}</legend>
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
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-2 text-lg font-semibold">{t('tournaments.sections.dates')}</legend>
        {hint('tournament-dates-hint', t('tournaments.datesHint'))}
        <div className="grid gap-4 sm:grid-cols-2">
          {dateField('start_date', t('tournaments.startDate'), true)}
          {dateField('end_date', t('tournaments.endDate'), true)}
          {dateField('registration_open_at', t('tournaments.registrationOpenOptional'), false)}
          {dateField('registration_close_at', t('tournaments.registrationCloseOptional'), false)}
        </div>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-2 text-lg font-semibold">{t('tournaments.sections.participants')}</legend>
        {capacityLocked ? (
          <p id="tournament-locked-hint" className="rounded-lg border border-border p-3 text-sm">
            {t('tournaments.capacityLockedHint')}
          </p>
        ) : null}

        <fieldset className="grid gap-2" aria-describedby="tournament-type-hint">
          <legend className="text-sm font-medium">{t('tournaments.participantTypeLabel')}</legend>
          <div className="flex flex-wrap gap-4">
            {PARTICIPANT_TYPES.map((type) => (
              <label key={type} className="inline-flex items-center gap-2 text-sm">
                <input
                  id={`tournament-type-${type}`}
                  type="radio"
                  name="participant_type"
                  value={type}
                  checked={values.participant_type === type}
                  disabled={!creating}
                  onChange={() =>
                    setValues((current) => ({
                      ...current,
                      participant_type: type,
                      team_size: type === 'team' ? current.team_size : '',
                    }))
                  }
                  className="size-4 accent-primary"
                />
                {t(participantTypeLabelKey(type))}
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
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? t('tournaments.saving') : submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
