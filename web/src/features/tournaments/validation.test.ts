import { ApiError, NetworkError } from '@/lib/api/http'
import { BOB, GAME_A, ME, TT_MINE } from '@/test/render'
import { P_BOB, P_ME, SOLO, TEAM_CUP } from '@/test/tournaments'
import { serverDetail, tournamentErrorKey, tournamentFieldErrors } from './errors'
import {
  canActOn,
  canCheckIn,
  capacityLocked,
  deletable,
  hasTeamRanking,
  nextStatuses,
  registrationWindow,
  scoringEditable,
  withdrawalMode,
} from './lifecycle'
import type { TournamentValues } from './types'
import {
  buildScoringDefinition,
  changedTournamentFields,
  EMPTY_TOURNAMENT,
  fromLocalInput,
  pointsRows,
  toLocalInput,
  toTournamentInput,
  tournamentValues,
  validateTournament,
} from './validation'

const VALID: TournamentValues = {
  ...EMPTY_TOURNAMENT,
  game_id: GAME_A.id,
  name: '  TFT Open ',
  start_date: '2026-11-14T18:00',
  end_date: '2026-11-15T22:00',
  max_participants: '32',
}

describe('dates', () => {
  it('convertit l\'heure locale du formulaire en UTC RFC 3339, et inversement', () => {
    const iso = fromLocalInput('2026-11-14T18:00')
    expect(iso).toBe(new Date('2026-11-14T18:00').toISOString())
    expect(toLocalInput(iso)).toBe('2026-11-14T18:00')
    expect(fromLocalInput('')).toBeNull()
    expect(fromLocalInput('14/11/2026')).toBeNull()
    expect(toLocalInput(null)).toBe('')
  })
})

describe('validateTournament', () => {
  it('accepte un tournoi solo complet', () => {
    expect(validateTournament(VALID)).toEqual({})
  })

  it('applique les règles du serveur', () => {
    const errors = validateTournament({
      ...VALID,
      game_id: 'x',
      name: 'a'.repeat(129),
      description: 'd'.repeat(4001),
      end_date: '2026-11-13T18:00',
      registration_open_at: '2026-11-10T10:00',
      registration_close_at: '2026-11-09T10:00',
      max_participants: '10001',
    })
    expect(errors).toEqual({
      game_id: 'tournaments.validation.game',
      name: 'tournaments.validation.name',
      description: 'tournaments.validation.description',
      end_date: 'tournaments.validation.endBeforeStart',
      registration_close_at: 'tournaments.validation.closeBeforeOpen',
      max_participants: 'tournaments.validation.capacity',
    })
  })

  it('exige team_size en équipe et team_scoring_n avec top_n', () => {
    expect(validateTournament({ ...VALID, participant_type: 'team', team_size: '0' })).toEqual({
      team_size: 'tournaments.validation.teamSize',
    })
    expect(validateTournament({ ...VALID, team_scoring_mode: 'top_n', team_scoring_n: '' })).toEqual({
      team_scoring_n: 'tournaments.validation.scoringN',
    })
    expect(validateTournament({ ...VALID, max_participants: '1.5' }).max_participants).toBeDefined()
    expect(validateTournament({ ...VALID, start_date: '' }).start_date).toBe('tournaments.validation.date')
  })

  it('ne vérifie pas le jeu en modification', () => {
    expect(validateTournament({ ...VALID, game_id: '' }, false)).toEqual({})
  })
})

describe('toTournamentInput', () => {
  it('omet les champs facultatifs vides et ceux sans objet', () => {
    expect(toTournamentInput({ ...VALID, team_size: '5' })).toEqual({
      game_id: GAME_A.id,
      name: 'TFT Open',
      start_date: fromLocalInput('2026-11-14T18:00'),
      end_date: fromLocalInput('2026-11-15T22:00'),
      participant_type: 'solo',
      max_participants: 32,
      team_scoring_mode: 'none',
    })
  })

  it('envoie team_size en équipe et team_scoring_n avec top_n', () => {
    const input = toTournamentInput({
      ...VALID,
      description: ' Desc ',
      registration_open_at: '2026-11-01T10:00',
      participant_type: 'team',
      team_size: '5',
      team_scoring_mode: 'top_n',
      team_scoring_n: '3',
    })
    expect(input).toMatchObject({
      description: 'Desc',
      registration_open_at: fromLocalInput('2026-11-01T10:00'),
      team_size: 5,
      team_scoring_n: 3,
    })
    expect(input).not.toHaveProperty('registration_close_at')
  })
})

describe('changedTournamentFields', () => {
  const original = { ...SOLO, registration_open_at: fromLocalInput('2026-11-01T10:00'), team_scoring_mode: 'top_n' as const, team_scoring_n: 2 }

  it('n\'envoie rien sans modification (dates comparées à la minute)', () => {
    expect(changedTournamentFields(original, tournamentValues(original))).toEqual({})
  })

  it('envoie null pour effacer une valeur facultative', () => {
    const values = { ...tournamentValues(original), description: ' ', registration_open_at: '', team_scoring_mode: 'sum' as const, team_scoring_n: '' }
    expect(changedTournamentFields(original, values)).toEqual({
      description: null,
      registration_open_at: null,
      team_scoring_mode: 'sum',
      team_scoring_n: null,
    })
  })

  it('n\'envoie que les champs modifiés', () => {
    const values = { ...tournamentValues(TEAM_CUP), name: 'New', team_size: '3', end_date: '2026-11-20T10:00' }
    expect(changedTournamentFields(TEAM_CUP, values)).toEqual({
      name: 'New',
      team_size: 3,
      end_date: fromLocalInput('2026-11-20T10:00'),
    })
  })
})

describe('barème', () => {
  it('linear exige un coefficient numérique (virgule acceptée)', () => {
    expect(buildScoringDefinition('linear', '1,5', [])).toEqual({ mode: 'linear', coefficient: 1.5 })
    expect(buildScoringDefinition('linear', '-2', [])).toEqual({ mode: 'linear', coefficient: -2 })
    expect(buildScoringDefinition('linear', 'abc', [])).toBe('tournaments.scoring.validation.coefficient')
  })

  it('table exige des lignes numériques sans doublon', () => {
    expect(
      buildScoringDefinition('table', '', [
        { value: '1', points: '8' },
        { value: '2', points: '7' },
        { value: '', points: '' },
      ]),
    ).toEqual({ mode: 'table', points_table: { '1': 8, '2': 7 } })
    expect(buildScoringDefinition('table', '', [{ value: '', points: '' }])).toBe('tournaments.scoring.validation.table')
    expect(buildScoringDefinition('table', '', [{ value: '1', points: 'x' }])).toBe('tournaments.scoring.validation.table')
    expect(
      buildScoringDefinition('table', '', [
        { value: '1', points: '1' },
        { value: '1', points: '2' },
      ]),
    ).toBe('tournaments.scoring.validation.table')
  })

  it('pointsRows trie les valeurs', () => {
    expect(pointsRows({ '10': 1, '2': 7 })).toEqual([
      { value: '2', points: '7' },
      { value: '10', points: '1' },
    ])
    expect(pointsRows(null)).toEqual([{ value: '', points: '' }])
  })
})

describe('cycle de vie et permissions', () => {
  it('ne propose que les transitions valides', () => {
    expect(nextStatuses('draft')).toEqual(['registration', 'cancelled'])
    expect(nextStatuses('registration')).toEqual(['ongoing', 'cancelled'])
    expect(nextStatuses('ongoing')).toEqual(['finished', 'cancelled'])
    expect(nextStatuses('finished')).toEqual([])
    expect(nextStatuses('cancelled')).toEqual([])
  })

  it('reproduit les verrous du serveur', () => {
    expect(capacityLocked('registration')).toBe(false)
    expect(capacityLocked('ongoing')).toBe(true)
    expect(capacityLocked('finished')).toBe(true)
    expect(scoringEditable('registration')).toBe(true)
    expect(scoringEditable('ongoing')).toBe(false)
    expect(deletable('ongoing')).toBe(false)
    expect(deletable('finished')).toBe(true)
  })

  it('calcule la fenêtre d\'inscription', () => {
    const now = new Date('2026-11-05T12:00:00Z')
    expect(registrationWindow(SOLO, now)).toBe('open')
    expect(registrationWindow({ ...SOLO, status: 'draft' }, now)).toBe('notRegistration')
    expect(registrationWindow({ ...SOLO, registration_open_at: '2026-11-06T00:00:00Z' }, now)).toBe('notYetOpen')
    expect(registrationWindow({ ...SOLO, registration_close_at: '2026-11-04T00:00:00Z' }, now)).toBe('closed')
  })

  it('autorise l\'inscrit, le propriétaire de l\'équipe inscrite et l\'administrateur', () => {
    const teams = new Map([[TT_MINE.id, TT_MINE]])
    const teamEntry = { ...P_ME, user_id: null }
    expect(canActOn(P_ME, ME.id, false, teams)).toBe(true)
    expect(canActOn(P_BOB, ME.id, false, teams)).toBe(false)
    expect(canActOn(P_BOB, ME.id, true, teams)).toBe(true)
    expect(canActOn(teamEntry, ME.id, false, teams)).toBe(true)
    expect(canActOn(teamEntry, BOB.id, false, teams)).toBe(false)
    expect(canActOn(P_ME, null, false, teams)).toBe(false)
  })

  it('pointage et retrait selon les statuts', () => {
    expect(canCheckIn(SOLO, P_ME)).toBe(true)
    expect(canCheckIn(SOLO, P_BOB)).toBe(false)
    expect(canCheckIn({ ...SOLO, status: 'ongoing' }, P_ME)).toBe(false)
    expect(withdrawalMode(SOLO, P_ME)).toBe('delete')
    expect(withdrawalMode({ ...SOLO, status: 'ongoing' }, P_ME)).toBe('status')
    expect(withdrawalMode({ ...SOLO, status: 'finished' }, P_ME)).toBeNull()
    expect(withdrawalMode(SOLO, { ...P_ME, status: 'withdrawn' })).toBeNull()
  })

  it('classement des équipes : par équipes, ou solo avec un mode de score', () => {
    expect(hasTeamRanking(TEAM_CUP)).toBe(true)
    expect(hasTeamRanking(SOLO)).toBe(true)
    expect(hasTeamRanking({ ...SOLO, team_scoring_mode: 'none' })).toBe(false)
  })
})

describe('erreurs', () => {
  it('traduit 400, 401, 403, 404 et les 409 du backend', () => {
    expect(tournamentErrorKey(new NetworkError())).toBe('games.errors.network')
    expect(tournamentErrorKey(new ApiError(401, {}))).toBe('games.errors.unauthorized')
    expect(tournamentErrorKey(new ApiError(403, {}))).toBe('tournaments.errors.forbidden')
    expect(tournamentErrorKey(new ApiError(404, {}))).toBe('tournaments.errors.notFound')
    for (const [code, key] of [
      ['tournament_locked', 'tournaments.errors.locked'],
      ['registration_closed', 'tournaments.errors.registrationClosed'],
      ['already_registered', 'tournaments.errors.alreadyRegistered'],
      ['tournament_full', 'tournaments.errors.full'],
      ['player_already_registered', 'teams.errors.playerRegistered'],
      ['scoring_rule_taken', 'tournaments.errors.scoringRuleTaken'],
      ['invalid_status_transition', 'tournaments.errors.invalidTransition'],
      ['tournament_name_taken', 'tournaments.errors.nameTaken'],
    ]) {
      expect(tournamentErrorKey(new ApiError(409, { error: code }))).toBe(key)
    }
    expect(tournamentErrorKey(new ApiError(409, { error: 'other' }))).toBe('tournaments.errors.conflict')
    expect(tournamentErrorKey(new ApiError(400, { errors: { stat_id: 'x' } }))).toBe('tournaments.scoring.errors.statNotLinked')
    expect(tournamentErrorKey(new ApiError(400, { errors: { status: 'x' } }))).toBe('tournaments.errors.startConditions')
    expect(tournamentErrorKey(new ApiError(400, { errors: { file: 'x' } }), 'file')).toBe('tournaments.errors.file')
    expect(tournamentErrorKey(new Error('boom'))).toBe('games.errors.generic')
  })

  it('renvoie le détail du serveur et les erreurs par champ', () => {
    const error = new ApiError(400, { errors: { status: 'Il faut au moins 2 inscrits actifs, il y en a 1.' } })
    expect(serverDetail(error, 'status')).toBe('Il faut au moins 2 inscrits actifs, il y en a 1.')
    expect(serverDetail(new ApiError(409, {}), 'status')).toBeUndefined()
    expect(tournamentFieldErrors(new ApiError(409, { error: 'tournament_name_taken' }))).toEqual({
      name: 'tournaments.errors.nameTaken',
    })
    expect(tournamentFieldErrors(new ApiError(400, { errors: { max_participants: '3 participants' } }))).toEqual({
      max_participants: 'tournaments.errors.capacityBelowRegistered',
    })
    expect(tournamentFieldErrors(new ApiError(500, {}))).toBeNull()
  })
})
