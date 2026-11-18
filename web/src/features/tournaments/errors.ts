import type { MessageKey } from '@/i18n/context'
import { getErrorCode, getFieldErrors } from '@/lib/api/errors'
import { ApiError, NetworkError } from '@/lib/api/http'
import type { TournamentFieldErrors } from './types'

const CODES: Record<string, MessageKey> = {
  tournament_name_taken: 'tournaments.errors.nameTaken',
  tournament_locked: 'tournaments.errors.locked',
  invalid_status_transition: 'tournaments.errors.invalidTransition',
  registration_closed: 'tournaments.errors.registrationClosed',
  already_registered: 'tournaments.errors.alreadyRegistered',
  tournament_full: 'tournaments.errors.full',
  player_already_registered: 'teams.errors.playerRegistered',
  team_already_registered: 'teams.errors.alreadyRegistered',
  scoring_rule_taken: 'tournaments.errors.scoringRuleTaken',
  check_in_closed: 'tournaments.errors.checkInClosed',
  invalid_participant_state: 'tournaments.errors.participantState',
  ownership_changed: 'tournaments.errors.ownershipChanged',
  stat_in_use: 'stats.errors.inUse',
}

// Champs détaillés d'un 400 (`errors`) : le premier trouvé l'emporte.
const FIELDS: Array<[string, MessageKey]> = [
  ['status', 'tournaments.errors.startConditions'],
  ['game_id', 'tournaments.validation.game'],
  ['name', 'tournaments.validation.name'],
  ['description', 'tournaments.validation.description'],
  ['start_date', 'tournaments.validation.date'],
  ['end_date', 'tournaments.validation.endBeforeStart'],
  ['registration_open_at', 'tournaments.validation.date'],
  ['registration_close_at', 'tournaments.validation.closeBeforeOpen'],
  ['max_participants', 'tournaments.validation.capacity'],
  ['team_size', 'tournaments.validation.starters'],
  ['team_min_starters', 'tournaments.validation.starters'],
  ['team_max_starters', 'tournaments.validation.maxBelowMin'],
  ['team_max_substitutes', 'tournaments.validation.substitutes'],
  ['team_scoring_n', 'tournaments.validation.scoringN'],
  ['location', 'tournaments.validation.location'],
  ['rules', 'tournaments.validation.rules'],
  ['registration_fields', 'tournaments.validation.fields'],
  ['check_in_open_at', 'tournaments.validation.date'],
  ['check_in_close_at', 'tournaments.validation.checkInOrder'],
  ['responses', 'tournaments.participants.errors.responses'],
  ['role', 'tournaments.errors.rosterFull'],
  ['stat_id', 'tournaments.scoring.errors.statNotLinked'],
  ['coefficient', 'tournaments.scoring.validation.coefficient'],
  ['points_table', 'tournaments.scoring.validation.table'],
  ['user_id', 'tournaments.participants.errors.user'],
  ['tournament_team_id', 'tournaments.participants.errors.team'],
]

// Traduit une erreur d'API en clé de message : 400, 401, 403, 404 et 409 ont chacun leur texte.
export function tournamentErrorKey(error: unknown, context: 'default' | 'file' = 'default'): MessageKey {
  if (error instanceof NetworkError) return 'games.errors.network'
  if (error instanceof ApiError) {
    const code = getErrorCode(error.body)
    if (error.status === 401) return 'games.errors.unauthorized'
    if (error.status === 403) return 'tournaments.errors.forbidden'
    if (error.status === 404) return 'tournaments.errors.notFound'
    if (code && CODES[code]) return CODES[code]
    if (error.status === 409) return 'tournaments.errors.conflict'
    if (error.status === 413) return 'games.errors.fileTooLarge'
    if (error.status === 400) {
      if (context === 'file') return 'tournaments.errors.file'
      const fields = getFieldErrors(error.body, FIELDS.map(([field]) => field))
      for (const [field, key] of FIELDS) if (fields[field]) return key
      return 'games.errors.invalid'
    }
  }
  return 'games.errors.generic'
}

// Détail renvoyé par le serveur pour un champ (ex. conditions de démarrage dans errors.status,
// problèmes d'un fichier dans errors.file) ; affiché tel quel sous le message traduit.
export function serverDetail(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError) || error.status !== 400) return undefined
  return getFieldErrors(error.body, [field])[field]
}

// Erreurs à afficher sur les champs du formulaire (409 tournament_name_taken, 400 détaillé) ;
// null quand l'erreur concerne le formulaire entier.
export function tournamentFieldErrors(error: unknown): TournamentFieldErrors | null {
  if (error instanceof ApiError && getErrorCode(error.body) === 'tournament_name_taken') {
    return { name: 'tournaments.errors.nameTaken' }
  }
  if (!(error instanceof ApiError) || error.status !== 400) return null
  const found = getFieldErrors(error.body, [
    'game_id',
    'name',
    'description',
    'start_date',
    'end_date',
    'registration_open_at',
    'registration_close_at',
    'max_participants',
    'team_size',
    'team_min_starters',
    'team_max_starters',
    'team_max_substitutes',
    'team_scoring_n',
    'location',
    'rules',
    'registration_fields',
    'check_in_open_at',
    'check_in_close_at',
  ])
  const errors: TournamentFieldErrors = {}
  if (found.game_id) errors.game_id = 'tournaments.validation.game'
  if (found.name) errors.name = 'tournaments.validation.name'
  if (found.description) errors.description = 'tournaments.validation.description'
  if (found.start_date) errors.start_date = 'tournaments.validation.date'
  if (found.end_date) errors.end_date = 'tournaments.validation.endBeforeStart'
  if (found.registration_open_at) errors.registration_open_at = 'tournaments.validation.date'
  if (found.registration_close_at) errors.registration_close_at = 'tournaments.validation.closeBeforeOpen'
  // Le seul 400 possible sur une capacité valide : moins de places que d'inscrits actifs.
  if (found.max_participants) errors.max_participants = 'tournaments.errors.capacityBelowRegistered'
  if (found.team_size) errors.team_min_starters = 'tournaments.validation.starters'
  // Les équipes déjà inscrites ne respectent plus la nouvelle composition (détail du serveur).
  if (found.team_min_starters) {
    errors.team_min_starters = /inscrite/.test(found.team_min_starters)
      ? 'tournaments.errors.teamsDontFit'
      : 'tournaments.validation.starters'
  }
  if (found.team_max_starters) errors.team_max_starters = 'tournaments.validation.maxBelowMin'
  if (found.team_max_substitutes) errors.team_max_substitutes = 'tournaments.validation.substitutes'
  if (found.location) errors.location = 'tournaments.validation.location'
  if (found.rules) errors.rules = 'tournaments.validation.rules'
  if (found.registration_fields) errors.registration_fields = 'tournaments.validation.fields'
  if (found.check_in_open_at) errors.check_in_open_at = 'tournaments.validation.date'
  if (found.check_in_close_at) errors.check_in_close_at = 'tournaments.validation.checkInOrder'
  if (found.team_scoring_n) errors.team_scoring_n = 'tournaments.validation.scoringN'
  return Object.keys(errors).length > 0 ? errors : null
}
