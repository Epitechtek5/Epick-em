import {
  Calendar03Icon,
  CheckListIcon,
  FloppyDiskIcon,
  Globe02Icon,
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
import {
  modeLabelKey,
  participantTypeLabelKey,
  policyLabelKey,
  teamScoringLabelKey,
  visibilityLabelKey,
} from '@/features/tournaments/labels'
import {
  PARTICIPANT_TYPES,
  REGISTRATION_POLICIES,
  TEAM_SCORING_MODES,
  TOURNAMENT_MODES,
  VISIBILITIES,
  type RegistrationPolicy,
  type TeamScoringMode,
  type TournamentMode,
  type TournamentField,
  type TournamentFieldErrors,
  type TournamentValues,
  type Visibility,
} from '@/features/tournaments/types'
import {
  CAPACITY_MAX,
  DESCRIPTION_MAX,
  EMPTY_TOURNAMENT,
  FIELDS_MAX,
  LOCATION_MAX,
  RULES_MAX,
  TEAM_SIZE_MAX,
  validateTournament,
} from '@/features/tournaments/validation'
import { useI18n, type MessageKey } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { RegistrationFieldsEditor } from './RegistrationFieldsEditor'
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
  max_participants: 'tournament-capacity',
  team_scoring_mode: 'tournament-team-scoring',
  team_scoring_n: 'tournament-team-scoring-n',
  mode: 'tournament-mode',
  location: 'tournament-location',
  visibility: 'tournament-visibility',
  rules: 'tournament-rules',
  team_min_starters: 'tournament-min-starters',
  team_max_starters: 'tournament-max-starters',
  team_max_substitutes: 'tournament-max-substitutes',
  registration_policy: 'tournament-registration-policy',
  waiting_list_enabled: 'tournament-waiting-list',
  registration_fields: 'tournament-registration-fields',
  check_in_open_at: 'tournament-check-in-open',
  check_in_close_at: 'tournament-check-in-close',
}
const ORDER: TournamentField[] = [
  'game_id',
  'name',
  'description',
  'start_date',
  'end_date',
  'registration_open_at',
  'registration_close_at',
  'mode',
  'location',
  'visibility',
  'rules',
  'participant_type',
  'team_min_starters',
  'team_max_starters',
  'team_max_substitutes',
  'max_participants',
  'team_scoring_mode',
  'team_scoring_n',
  'registration_policy',
  'waiting_list_enabled',
  'registration_fields',
  'check_in_open_at',
  'check_in_close_at',
]

// Borne affichée dans le message d'erreur de chaque champ.
const LIMITS: Partial<Record<TournamentField, number>> = {
  max_participants: CAPACITY_MAX,
  location: LOCATION_MAX,
  rules: RULES_MAX,
  registration_fields: FIELDS_MAX,
}

interface TournamentFormProps {
  initial?: TournamentValues
  // Création : liste des jeux (le jeu et le type de participant ne se changent plus ensuite).
  games?: Game[]
  // Tournoi en cours ou terminé : capacité, composition des équipes et score d'équipe verrouillés.
  capacityLocked?: boolean
  // Pointage verrouillé (tournoi en cours, ou clôture déjà traitée).
  checkInLocked?: boolean
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
  checkInLocked = false,
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
    if (key) messages[field] = t(key, { max: LIMITS[field] ?? TEAM_SIZE_MAX })
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

  const dateField = (
    field: 'start_date' | 'end_date' | 'registration_open_at' | 'registration_close_at' | 'check_in_open_at' | 'check_in_close_at',
    label: string,
    required: boolean,
    disabled = false,
  ) => (
    <div className="grid gap-2">
      <Label htmlFor={IDS[field]}>{label}</Label>
      <Input
        id={IDS[field]}
        type="datetime-local"
        value={values[field]}
        required={required}
        disabled={disabled}
        aria-invalid={messages[field] ? true : undefined}
        aria-describedby={describe(field, field.startsWith('check_in') ? 'tournament-check-in-hint' : 'tournament-dates-hint')}
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

        <FormSection icon={Globe02Icon} title={t('tournaments.sections.format')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={IDS.mode}>{t('tournaments.modeLabel')}</Label>
              <NativeSelect
                id={IDS.mode}
                value={values.mode}
                aria-describedby="tournament-mode-hint"
                onChange={(event) => set('mode', event.target.value as TournamentMode)}
              >
                {TOURNAMENT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(modeLabelKey(mode))}
                  </option>
                ))}
              </NativeSelect>
              {hint('tournament-mode-hint', t('tournaments.modeHint'))}
            </div>
            <div className="grid gap-2">
              <Label htmlFor={IDS.visibility}>{t('tournaments.visibilityLabel')}</Label>
              <NativeSelect
                id={IDS.visibility}
                value={values.visibility}
                aria-describedby="tournament-visibility-hint"
                onChange={(event) => set('visibility', event.target.value as Visibility)}
              >
                {VISIBILITIES.map((visibility) => (
                  <option key={visibility} value={visibility}>
                    {t(visibilityLabelKey(visibility))}
                  </option>
                ))}
              </NativeSelect>
              {hint(
                'tournament-visibility-hint',
                t(values.visibility === 'public' ? 'tournaments.visibilityHint.public' : 'tournaments.visibilityHint.invitation_only'),
              )}
            </div>
          </div>
          {values.mode !== 'online' ? (
            <div className="grid gap-2">
              <Label htmlFor={IDS.location}>{t('tournaments.locationOptional')}</Label>
              <Input
                id={IDS.location}
                value={values.location}
                autoComplete="off"
                aria-invalid={messages.location ? true : undefined}
                aria-describedby={describe('location', 'tournament-location-hint')}
                onChange={(event) => set('location', event.target.value)}
              />
              {hint('tournament-location-hint', t('tournaments.locationHint', { max: LOCATION_MAX }))}
              {fieldError('location')}
            </div>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor={IDS.rules}>{t('tournaments.rulesOptional')}</Label>
            <Textarea
              id={IDS.rules}
              value={values.rules}
              aria-invalid={messages.rules ? true : undefined}
              aria-describedby={describe('rules', 'tournament-rules-hint')}
              onChange={(event) => set('rules', event.target.value)}
            />
            {hint(
              'tournament-rules-hint',
              t('tournaments.rulesHint', { count: Array.from(values.rules.trim()).length, max: RULES_MAX }),
            )}
            {fieldError('rules')}
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
                        team_min_starters: type === 'team' ? current.team_min_starters : '',
                        team_max_starters: type === 'team' ? current.team_max_starters : '',
                        team_max_substitutes: type === 'team' ? current.team_max_substitutes : '',
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
              <>
              <div className="grid gap-2">
                <Label htmlFor={IDS.team_min_starters}>{t('tournaments.minStarters')}</Label>
                <Input
                  id={IDS.team_min_starters}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={TEAM_SIZE_MAX}
                  step={1}
                  value={values.team_min_starters}
                  required={true}
                  disabled={capacityLocked}
                  aria-invalid={messages.team_min_starters ? true : undefined}
                  aria-describedby={describe('team_min_starters', 'tournament-team-min-starters-hint', lockedHint)}
                  onChange={(event) => set('team_min_starters', event.target.value)}
                />
                {hint('tournament-team-min-starters-hint', t('tournaments.minStartersHint', { max: TEAM_SIZE_MAX }))}
                {fieldError('team_min_starters')}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={IDS.team_max_starters}>{t('tournaments.maxStarters')}</Label>
                <Input
                  id={IDS.team_max_starters}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={TEAM_SIZE_MAX}
                  step={1}
                  value={values.team_max_starters}
                  required={true}
                  disabled={capacityLocked}
                  aria-invalid={messages.team_max_starters ? true : undefined}
                  aria-describedby={describe('team_max_starters', 'tournament-team-max-starters-hint', lockedHint)}
                  onChange={(event) => set('team_max_starters', event.target.value)}
                />
                {hint('tournament-team-max-starters-hint', t('tournaments.maxStartersHint', { max: TEAM_SIZE_MAX }))}
                {fieldError('team_max_starters')}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={IDS.team_max_substitutes}>{t('tournaments.maxSubstitutesOptional')}</Label>
                <Input
                  id={IDS.team_max_substitutes}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={TEAM_SIZE_MAX}
                  step={1}
                  value={values.team_max_substitutes}
                  required={false}
                  disabled={capacityLocked}
                  aria-invalid={messages.team_max_substitutes ? true : undefined}
                  aria-describedby={describe('team_max_substitutes', 'tournament-team-max-substitutes-hint', lockedHint)}
                  onChange={(event) => set('team_max_substitutes', event.target.value)}
                />
                {hint('tournament-team-max-substitutes-hint', t('tournaments.maxSubstitutesHint', { max: TEAM_SIZE_MAX }))}
                {fieldError('team_max_substitutes')}
              </div>
              </>
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

        <FormSection icon={CheckListIcon} title={t('tournaments.sections.registration')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={IDS.registration_policy}>{t('tournaments.policyLabel')}</Label>
              <NativeSelect
                id={IDS.registration_policy}
                value={values.registration_policy}
                aria-describedby="tournament-policy-hint"
                onChange={(event) => set('registration_policy', event.target.value as RegistrationPolicy)}
              >
                {REGISTRATION_POLICIES.map((policy) => (
                  <option key={policy} value={policy}>
                    {t(policyLabelKey(policy))}
                  </option>
                ))}
              </NativeSelect>
              {hint(
                'tournament-policy-hint',
                t(values.registration_policy === 'open' ? 'tournaments.policyHint.open' : 'tournaments.policyHint.approval_required'),
              )}
            </div>
            <div className="grid content-start gap-2">
              <label className="flex items-center gap-2 pt-7 text-sm font-medium">
                <input
                  id={IDS.waiting_list_enabled}
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={values.waiting_list_enabled}
                  aria-describedby="tournament-waiting-list-hint"
                  onChange={(event) => set('waiting_list_enabled', event.target.checked)}
                />
                {t('tournaments.waitingList')}
              </label>
              {hint('tournament-waiting-list-hint', t('tournaments.waitingListHint'))}
            </div>
          </div>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{t('tournaments.fields.title')}</legend>
            {hint('tournament-fields-hint', t('tournaments.fields.hint', { max: FIELDS_MAX }))}
            <RegistrationFieldsEditor
              id={IDS.registration_fields}
              fields={values.registration_fields}
              invalid={Boolean(messages.registration_fields)}
              describedBy={describe('registration_fields', 'tournament-fields-hint')}
              onChange={(fields) => set('registration_fields', fields)}
            />
            {fieldError('registration_fields')}
          </fieldset>

          <div className="grid gap-4 rounded-xl bg-muted/40 p-4 sm:grid-cols-2">
            <p className="text-sm font-medium sm:col-span-2">{t('tournaments.checkInWindow')}</p>
            {checkInLocked ? (
              <p className="flex items-start gap-2 text-sm text-muted-foreground sm:col-span-2">
                <Icon icon={LockedIcon} size={18} className="mt-0.5 shrink-0" />
                {t('tournaments.checkInLockedHint')}
              </p>
            ) : null}
            {dateField('check_in_open_at', t('tournaments.checkInOpenOptional'), false, checkInLocked)}
            {dateField('check_in_close_at', t('tournaments.checkInCloseOptional'), false, checkInLocked)}
            <p id="tournament-check-in-hint" className="text-sm text-muted-foreground sm:col-span-2">
              {t('tournaments.checkInHint')}
            </p>
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
