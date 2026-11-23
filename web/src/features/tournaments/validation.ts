import { isUuid } from '@/features/teams/validation'
import type {
  RegistrationField,
  RegistrationResponses,
  ScoringRuleDefinition,
  Tournament,
  TournamentChanges,
  TournamentFieldErrors,
  TournamentInput,
  TournamentValues,
} from './types'

// Mêmes bornes que le serveur (api-public/tournaments.rs).
export const NAME_MAX = 128
export const DESCRIPTION_MAX = 4000
export const CAPACITY_MAX = 10_000
export const TEAM_SIZE_MAX = 100
// Configuration (api-public/tournament_settings.rs).
export const LOCATION_MAX = 255
export const RULES_MAX = 20_000
export const FIELDS_MAX = 30
export const FIELD_KEY_MAX = 40
export const FIELD_LABEL_MAX = 100
export const OPTIONS_MAX = 50
export const ANSWER_MAX = 500

// ---- Dates ----------------------------------------------------------------------------------
// Le formulaire utilise <input type="datetime-local"> (heure locale, à la minute) ; l'API reçoit
// et renvoie de l'UTC RFC 3339 (suffixe Z).

function pad(value: number) {
  return String(value).padStart(2, '0')
}

// UTC RFC 3339 → valeur `datetime-local` (YYYY-MM-DDTHH:mm, heure locale). Vide si invalide.
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Valeur `datetime-local` → UTC RFC 3339 ; null si vide ou invalide.
export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value.trim())) return null
  const date = new Date(value.trim())
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

// ---- Formulaire de tournoi ------------------------------------------------------------------

export const EMPTY_TOURNAMENT: TournamentValues = {
  game_id: '',
  name: '',
  description: '',
  start_date: '',
  end_date: '',
  registration_open_at: '',
  registration_close_at: '',
  participant_type: 'solo',
  max_participants: '',
  team_scoring_mode: 'none',
  team_scoring_n: '',
  mode: 'online',
  location: '',
  visibility: 'public',
  rules: '',
  team_min_starters: '',
  team_max_starters: '',
  team_max_substitutes: '',
  registration_policy: 'open',
  waiting_list_enabled: false,
  registration_fields: [],
  check_in_open_at: '',
  check_in_close_at: '',
}

const text = (value: number | null) => (value === null ? '' : String(value))

export function tournamentValues(tournament: Tournament): TournamentValues {
  return {
    game_id: tournament.game_id,
    name: tournament.name,
    description: tournament.description ?? '',
    start_date: toLocalInput(tournament.start_date),
    end_date: toLocalInput(tournament.end_date),
    registration_open_at: toLocalInput(tournament.registration_open_at),
    registration_close_at: toLocalInput(tournament.registration_close_at),
    participant_type: tournament.participant_type,
    max_participants: String(tournament.max_participants),
    team_scoring_mode: tournament.team_scoring_mode,
    team_scoring_n: text(tournament.team_scoring_n),
    mode: tournament.mode ?? 'online',
    location: tournament.location ?? '',
    visibility: tournament.visibility ?? 'public',
    rules: tournament.rules ?? '',
    team_min_starters: text(tournament.team_min_starters ?? tournament.team_size ?? null),
    team_max_starters: text(tournament.team_max_starters ?? tournament.team_size ?? null),
    team_max_substitutes: text(tournament.team_max_substitutes ?? null),
    registration_policy: tournament.registration_policy ?? 'open',
    waiting_list_enabled: tournament.waiting_list_enabled ?? false,
    registration_fields: (tournament.registration_fields ?? []).map((field) => ({ ...field, options: [...field.options] })),
    check_in_open_at: toLocalInput(tournament.check_in_open_at),
    check_in_close_at: toLocalInput(tournament.check_in_close_at),
  }
}

// ---- Champs d'inscription personnalisés ----------------------------------------------------

const KEY_PATTERN = /^[A-Za-z0-9_]+$/

// Clé proposée à partir du libellé (sans accents, `_` entre les mots), unique parmi `taken`.
export function suggestFieldKey(label: string, taken: readonly string[]): string {
  const base =
    label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, FIELD_KEY_MAX) || 'field'
  let key = base
  for (let n = 2; taken.includes(key); n += 1) key = `${base.slice(0, FIELD_KEY_MAX - String(n).length - 1)}_${n}`
  return key
}

// Mêmes règles que le serveur : au plus 30 champs, clés uniques (1 à 40 lettres, chiffres ou
// `_`), libellé de 1 à 100 caractères, options distinctes et non vides pour `select` seulement.
// Renvoie l'index du premier champ invalide, -1 pour une liste trop longue, null sinon.
export function invalidFieldIndex(fields: readonly RegistrationField[]): number | null {
  if (fields.length > FIELDS_MAX) return -1
  const keys = new Set<string>()
  for (const [index, field] of fields.entries()) {
    const key = field.key.trim()
    if (!key || key.length > FIELD_KEY_MAX || !KEY_PATTERN.test(key) || keys.has(key)) return index
    keys.add(key)
    const label = Array.from(field.label.trim()).length
    if (label < 1 || label > FIELD_LABEL_MAX) return index
    const options = field.options.map((option) => option.trim())
    if (field.field_type === 'select') {
      if (options.length === 0 || options.length > OPTIONS_MAX) return index
      if (options.some((option) => !option) || new Set(options).size !== options.length) return index
    } else if (options.length > 0) {
      return index
    }
  }
  return null
}

function cleanFields(fields: readonly RegistrationField[]): RegistrationField[] {
  return fields.map((field) => ({
    key: field.key.trim(),
    label: field.label.trim(),
    field_type: field.field_type,
    required: field.required,
    options: field.field_type === 'select' ? field.options.map((option) => option.trim()) : [],
  }))
}

// Valeurs saisies dans le formulaire d'inscription : texte, nombre en texte, case à cocher.
export type ResponseValues = Record<string, string | boolean>

export type ResponseError = 'required' | 'number' | 'option' | 'tooLong'

// Valide les réponses comme le serveur et renvoie le corps à envoyer (champs vides omis).
export function buildResponses(
  fields: readonly RegistrationField[],
  values: ResponseValues,
): { responses: RegistrationResponses; errors: Record<string, ResponseError> } {
  const responses: RegistrationResponses = {}
  const errors: Record<string, ResponseError> = {}
  for (const field of fields) {
    const raw = values[field.key]
    if (field.field_type === 'boolean') {
      // Une case non cochée vaut `false` ; obligatoire, elle doit être cochée.
      const checked = raw === true
      if (field.required && !checked) errors[field.key] = 'required'
      else responses[field.key] = checked
      continue
    }
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (!value) {
      if (field.required) errors[field.key] = 'required'
      continue
    }
    if (field.field_type === 'number') {
      const number = Number(value.replace(',', '.'))
      if (!/^-?\d+([.,]\d+)?$/.test(value) || !Number.isFinite(number)) errors[field.key] = 'number'
      else responses[field.key] = number
    } else if (field.field_type === 'select') {
      if (!field.options.includes(value)) errors[field.key] = 'option'
      else responses[field.key] = value
    } else if (Array.from(value).length > ANSWER_MAX) {
      errors[field.key] = 'tooLong'
    } else {
      responses[field.key] = value
    }
  }
  return { responses, errors }
}

// Entier dans [min, max] écrit en chiffres uniquement ; null sinon.
export function parseBoundedInt(value: string, min: number, max: number): number | null {
  const text = value.trim()
  if (!/^\d+$/.test(text)) return null
  const number = Number(text)
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null
}

// Mêmes règles que le serveur ; `checkGame` à false en modification (le jeu ne change pas).
export function validateTournament(values: TournamentValues, checkGame = true): TournamentFieldErrors {
  const errors: TournamentFieldErrors = {}
  if (checkGame && !isUuid(values.game_id)) errors.game_id = 'tournaments.validation.game'
  const nameLength = Array.from(values.name.trim()).length
  if (nameLength < 1 || nameLength > NAME_MAX) errors.name = 'tournaments.validation.name'
  if (Array.from(values.description.trim()).length > DESCRIPTION_MAX) {
    errors.description = 'tournaments.validation.description'
  }

  const start = fromLocalInput(values.start_date)
  const end = fromLocalInput(values.end_date)
  if (!start) errors.start_date = 'tournaments.validation.date'
  if (!end) errors.end_date = 'tournaments.validation.date'
  if (start && end && end < start) errors.end_date = 'tournaments.validation.endBeforeStart'

  const open = values.registration_open_at.trim() ? fromLocalInput(values.registration_open_at) : null
  const close = values.registration_close_at.trim() ? fromLocalInput(values.registration_close_at) : null
  if (values.registration_open_at.trim() && !open) errors.registration_open_at = 'tournaments.validation.date'
  if (values.registration_close_at.trim() && !close) errors.registration_close_at = 'tournaments.validation.date'
  if (open && close && close < open) errors.registration_close_at = 'tournaments.validation.closeBeforeOpen'

  if (parseBoundedInt(values.max_participants, 1, CAPACITY_MAX) === null) {
    errors.max_participants = 'tournaments.validation.capacity'
  }
  if (values.participant_type === 'team') {
    const min = parseBoundedInt(values.team_min_starters, 1, TEAM_SIZE_MAX)
    const max = parseBoundedInt(values.team_max_starters, 1, TEAM_SIZE_MAX)
    if (min === null) errors.team_min_starters = 'tournaments.validation.starters'
    if (max === null) errors.team_max_starters = 'tournaments.validation.starters'
    else if (min !== null && max < min) errors.team_max_starters = 'tournaments.validation.maxBelowMin'
    if (values.team_max_substitutes.trim() && parseBoundedInt(values.team_max_substitutes, 0, TEAM_SIZE_MAX) === null) {
      errors.team_max_substitutes = 'tournaments.validation.substitutes'
    }
  }
  if (Array.from(values.location.trim()).length > LOCATION_MAX) errors.location = 'tournaments.validation.location'
  if (Array.from(values.rules.trim()).length > RULES_MAX) errors.rules = 'tournaments.validation.rules'
  if (invalidFieldIndex(values.registration_fields) !== null) {
    errors.registration_fields = 'tournaments.validation.fields'
  }
  const checkOpen = values.check_in_open_at.trim() ? fromLocalInput(values.check_in_open_at) : null
  const checkClose = values.check_in_close_at.trim() ? fromLocalInput(values.check_in_close_at) : null
  if (values.check_in_open_at.trim() && !checkOpen) errors.check_in_open_at = 'tournaments.validation.date'
  if (values.check_in_close_at.trim() && !checkClose) errors.check_in_close_at = 'tournaments.validation.date'
  if (checkOpen && checkClose && checkClose < checkOpen) {
    errors.check_in_close_at = 'tournaments.validation.checkInOrder'
  }
  if (values.team_scoring_mode === 'top_n' && parseBoundedInt(values.team_scoring_n, 1, TEAM_SIZE_MAX) === null) {
    errors.team_scoring_n = 'tournaments.validation.scoringN'
  }
  return errors
}

const optionalDate = (value: string) => (value.trim() ? fromLocalInput(value) : null)

// Corps de POST /tournaments, à partir de valeurs déjà validées. Les champs facultatifs vides
// sont omis ; la composition n'est envoyée qu'en équipe, team_scoring_n qu'avec top_n.
export function toTournamentInput(values: TournamentValues): TournamentInput {
  const description = values.description.trim()
  const open = values.registration_open_at.trim() ? fromLocalInput(values.registration_open_at) : null
  const close = values.registration_close_at.trim() ? fromLocalInput(values.registration_close_at) : null
  return {
    game_id: values.game_id,
    name: values.name.trim(),
    ...(description ? { description } : {}),
    start_date: fromLocalInput(values.start_date) ?? '',
    end_date: fromLocalInput(values.end_date) ?? '',
    ...(open ? { registration_open_at: open } : {}),
    ...(close ? { registration_close_at: close } : {}),
    participant_type: values.participant_type,
    max_participants: Number(values.max_participants.trim()),
    team_scoring_mode: values.team_scoring_mode,
    ...(values.team_scoring_mode === 'top_n' ? { team_scoring_n: Number(values.team_scoring_n.trim()) } : {}),
    mode: values.mode,
    ...(values.location.trim() ? { location: values.location.trim() } : {}),
    visibility: values.visibility,
    ...(values.rules.trim() ? { rules: values.rules.trim() } : {}),
    ...(values.participant_type === 'team'
      ? {
          team_min_starters: Number(values.team_min_starters.trim()),
          team_max_starters: Number(values.team_max_starters.trim()),
          ...(values.team_max_substitutes.trim()
            ? { team_max_substitutes: Number(values.team_max_substitutes.trim()) }
            : {}),
        }
      : {}),
    registration_policy: values.registration_policy,
    waiting_list_enabled: values.waiting_list_enabled,
    registration_fields: cleanFields(values.registration_fields),
    ...(optionalDate(values.check_in_open_at) ? { check_in_open_at: optionalDate(values.check_in_open_at) ?? '' } : {}),
    ...(optionalDate(values.check_in_close_at) ? { check_in_close_at: optionalDate(values.check_in_close_at) ?? '' } : {}),
  }
}

// Corps de PATCH /tournaments/{id} : uniquement les champs modifiés (les dates sont comparées à
// la minute, comme le formulaire) ; `null` efface une valeur facultative. Les réglages de
// capacité ne sont jamais envoyés s'ils n'ont pas changé (le serveur les verrouille dès `ongoing`).
export function changedTournamentFields(original: Tournament, values: TournamentValues): TournamentChanges {
  const before = tournamentValues(original)
  const changes: TournamentChanges = {}
  const name = values.name.trim()
  if (name !== original.name) changes.name = name
  const description = values.description.trim()
  if (description !== (original.description ?? '')) changes.description = description || null

  if (values.start_date !== before.start_date) changes.start_date = fromLocalInput(values.start_date) ?? ''
  if (values.end_date !== before.end_date) changes.end_date = fromLocalInput(values.end_date) ?? ''
  if (values.registration_open_at.trim() !== before.registration_open_at) {
    changes.registration_open_at = values.registration_open_at.trim()
      ? fromLocalInput(values.registration_open_at)
      : null
  }
  if (values.registration_close_at.trim() !== before.registration_close_at) {
    changes.registration_close_at = values.registration_close_at.trim()
      ? fromLocalInput(values.registration_close_at)
      : null
  }

  const capacity = Number(values.max_participants.trim())
  if (capacity !== original.max_participants) changes.max_participants = capacity
  if (original.participant_type === 'team') {
    if (values.team_min_starters !== before.team_min_starters) {
      changes.team_min_starters = Number(values.team_min_starters.trim())
    }
    if (values.team_max_starters !== before.team_max_starters) {
      changes.team_max_starters = Number(values.team_max_starters.trim())
    }
    if (values.team_max_substitutes.trim() !== before.team_max_substitutes) {
      changes.team_max_substitutes = values.team_max_substitutes.trim()
        ? Number(values.team_max_substitutes.trim())
        : null
    }
  }
  // Configuration : seuls les champs modifiés partent (le serveur n'écrit que ceux-là).
  if (values.mode !== before.mode) changes.mode = values.mode
  if (values.location.trim() !== before.location) changes.location = values.location.trim() || null
  if (values.visibility !== before.visibility) changes.visibility = values.visibility
  if (values.rules.trim() !== before.rules) changes.rules = values.rules.trim() || null
  if (values.registration_policy !== before.registration_policy) {
    changes.registration_policy = values.registration_policy
  }
  if (values.waiting_list_enabled !== before.waiting_list_enabled) {
    changes.waiting_list_enabled = values.waiting_list_enabled
  }
  const fields = cleanFields(values.registration_fields)
  if (JSON.stringify(fields) !== JSON.stringify(cleanFields(before.registration_fields))) {
    changes.registration_fields = fields
  }
  if (values.check_in_open_at.trim() !== before.check_in_open_at) {
    changes.check_in_open_at = optionalDate(values.check_in_open_at)
  }
  if (values.check_in_close_at.trim() !== before.check_in_close_at) {
    changes.check_in_close_at = optionalDate(values.check_in_close_at)
  }
  if (values.team_scoring_mode !== original.team_scoring_mode) changes.team_scoring_mode = values.team_scoring_mode
  const n = values.team_scoring_mode === 'top_n' ? Number(values.team_scoring_n.trim()) : null
  if (n !== original.team_scoring_n) changes.team_scoring_n = n
  return changes
}

// ---- Barème ---------------------------------------------------------------------------------

export interface PointsRow {
  value: string
  points: string
}

export type ScoringRuleError =
  | 'tournaments.scoring.validation.stat'
  | 'tournaments.scoring.validation.coefficient'
  | 'tournaments.scoring.validation.table'

function finite(value: string): number | null {
  const text = value.trim().replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

// `linear` : coefficient numérique fini ; `table` : au moins une ligne, valeurs et points
// numériques, sans valeur en double (même règle que le serveur).
export function buildScoringDefinition(
  mode: 'linear' | 'table',
  coefficient: string,
  rows: PointsRow[],
): ScoringRuleDefinition | ScoringRuleError {
  if (mode === 'linear') {
    const value = finite(coefficient)
    return value === null ? 'tournaments.scoring.validation.coefficient' : { mode, coefficient: value }
  }
  const filled = rows.filter((row) => row.value.trim() || row.points.trim())
  if (filled.length === 0) return 'tournaments.scoring.validation.table'
  const table: Record<string, number> = {}
  for (const row of filled) {
    const value = finite(row.value)
    const points = finite(row.points)
    if (value === null || points === null) return 'tournaments.scoring.validation.table'
    const key = row.value.trim().replace(',', '.')
    if (key in table) return 'tournaments.scoring.validation.table'
    table[key] = points
  }
  return { mode, points_table: table }
}

// Lignes éditables d'une table de points, triées par valeur.
export function pointsRows(table: Record<string, number> | null): PointsRow[] {
  if (!table) return [{ value: '', points: '' }]
  return Object.entries(table)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([value, points]) => ({ value, points: String(points) }))
}
