import { isUuid } from '@/features/teams/validation'
import type {
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
  team_size: '',
  max_participants: '',
  team_scoring_mode: 'none',
  team_scoring_n: '',
}

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
    team_size: tournament.team_size === null ? '' : String(tournament.team_size),
    max_participants: String(tournament.max_participants),
    team_scoring_mode: tournament.team_scoring_mode,
    team_scoring_n: tournament.team_scoring_n === null ? '' : String(tournament.team_scoring_n),
  }
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
  if (values.participant_type === 'team' && parseBoundedInt(values.team_size, 1, TEAM_SIZE_MAX) === null) {
    errors.team_size = 'tournaments.validation.teamSize'
  }
  if (values.team_scoring_mode === 'top_n' && parseBoundedInt(values.team_scoring_n, 1, TEAM_SIZE_MAX) === null) {
    errors.team_scoring_n = 'tournaments.validation.scoringN'
  }
  return errors
}

// Corps de POST /tournaments, à partir de valeurs déjà validées. Les champs facultatifs vides
// sont omis ; team_size n'est envoyé qu'en équipe, team_scoring_n qu'avec top_n.
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
    ...(values.participant_type === 'team' ? { team_size: Number(values.team_size.trim()) } : {}),
    max_participants: Number(values.max_participants.trim()),
    team_scoring_mode: values.team_scoring_mode,
    ...(values.team_scoring_mode === 'top_n' ? { team_scoring_n: Number(values.team_scoring_n.trim()) } : {}),
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
    const size = Number(values.team_size.trim())
    if (size !== original.team_size) changes.team_size = size
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
