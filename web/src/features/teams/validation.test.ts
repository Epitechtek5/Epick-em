import { ApiError, NetworkError } from '@/lib/api/http'
import { teamErrorKey, teamFieldErrors } from './errors'
import { teamRoleLabelKey } from './labels'
import { changedTeamFields, ownsTeam, trimmedInput, uuid, validateTeam } from './validation'

const ok = { name: 'Karmine Corp', tag: 'KC', picture_url: '' }
const GAME = '11111111-1111-4111-8111-111111111111'

describe('validateTeam', () => {
  it('accepte une équipe valide, tag et photo facultatifs', () => {
    expect(validateTeam(ok)).toEqual({})
    expect(validateTeam({ ...ok, tag: '', picture_url: 'https://img.example/kc.png' })).toEqual({})
  })

  it('nom : 1 à 64 caractères Unicode après trim', () => {
    expect(validateTeam({ ...ok, name: '   ' }).name).toBeDefined()
    expect(validateTeam({ ...ok, name: ` ${'a'.repeat(64)} ` }).name).toBeUndefined()
    expect(validateTeam({ ...ok, name: 'a'.repeat(65) }).name).toBeDefined()
    expect(validateTeam({ ...ok, name: '🎮'.repeat(64) }).name).toBeUndefined()
  })

  it('tag : 8 caractères maximum', () => {
    expect(validateTeam({ ...ok, tag: 'ABCDEFGH' }).tag).toBeUndefined()
    expect(validateTeam({ ...ok, tag: 'ABCDEFGHI' }).tag).toBeDefined()
    expect(validateTeam({ ...ok, tag: '  KC  ' }).tag).toBeUndefined()
  })

  it.each(['ftp://a.example/x', 'img.example/x.png', 'https://a.example/x y', 'javascript:alert(1)'])(
    'refuse la photo %s',
    (url) => {
      expect(validateTeam({ ...ok, picture_url: url }).picture_url).toBeDefined()
    },
  )

  it('photo : 2048 octets maximum', () => {
    const base = 'https://a.example/'
    expect(validateTeam({ ...ok, picture_url: base + 'a'.repeat(2048 - base.length) }).picture_url).toBeUndefined()
    expect(validateTeam({ ...ok, picture_url: base + 'a'.repeat(2049 - base.length) }).picture_url).toBeDefined()
  })

  it('jeu : UUID obligatoire quand il est demandé', () => {
    expect(validateTeam(ok, '').game_id).toBeDefined()
    expect(validateTeam(ok, 'zelda').game_id).toBeDefined()
    expect(validateTeam(ok, GAME).game_id).toBeUndefined()
    expect(validateTeam(ok).game_id).toBeUndefined()
  })
})

describe('changedTeamFields / trimmedInput', () => {
  it('ne renvoie que les champs modifiés, et une chaîne vide pour effacer', () => {
    expect(changedTeamFields(ok, { ...ok, name: ' Karmine Corp ' })).toEqual({})
    expect(changedTeamFields({ ...ok, picture_url: 'https://x.example/a' }, { ...ok, tag: '' })).toEqual({
      tag: '',
      picture_url: '',
    })
  })

  it('omet tag et photo vides à la création', () => {
    expect(trimmedInput({ name: ' KC ', tag: ' ', picture_url: '' })).toEqual({ name: 'KC' })
  })
})

describe('permissions et identifiants', () => {
  it('ownsTeam ne reconnaît que le propriétaire', () => {
    expect(ownsTeam('a', 'a')).toBe(true)
    expect(ownsTeam('a', 'b')).toBe(false)
    expect(ownsTeam('a', null)).toBe(false)
    expect(ownsTeam(undefined, 'a')).toBe(false)
  })

  it('uuid rejette en 404 un identifiant invalide', () => {
    expect(uuid(GAME)).toBe(GAME)
    expect(() => uuid('nope')).toThrow(ApiError)
  })

  it('libellés de rôle', () => {
    expect(teamRoleLabelKey('owner')).toBe('teams.roles.owner')
    expect(teamRoleLabelKey('substitute')).toBe('teams.roles.substitute')
  })
})

describe('teamErrorKey', () => {
  it.each([
    [new NetworkError(), 'games.errors.network'],
    [new ApiError(401, {}), 'games.errors.unauthorized'],
    [new ApiError(403, {}), 'teams.errors.forbidden'],
    [new ApiError(404, {}), 'teams.errors.notFound'],
    [new ApiError(409, { error: 'team_name_taken' }), 'teams.errors.nameTaken'],
    [new ApiError(409, { error: 'already_team_member' }), 'teams.errors.alreadyMember'],
    [new ApiError(409, { error: 'team_already_registered' }), 'teams.errors.alreadyRegistered'],
    [new ApiError(409, { error: 'player_already_registered' }), 'teams.errors.playerRegistered'],
    [new ApiError(409, {}), 'teams.errors.conflict'],
    [new ApiError(400, { errors: { user_id: 'Compte introuvable.' } }), 'teams.errors.userInvalid'],
    [new ApiError(400, { errors: { role: 'x' } }), 'teams.errors.ownerRole'],
    [new ApiError(400, { errors: { member_ids: 'x' } }), 'teams.errors.memberSelection'],
    [new ApiError(400, {}), 'games.errors.invalid'],
    [new ApiError(500, {}), 'games.errors.generic'],
  ])('%o → %s', (error, key) => {
    expect(teamErrorKey(error)).toBe(key)
  })

  it('400 sur un fichier', () => {
    expect(teamErrorKey(new ApiError(400, { errors: { file: 'x' } }), 'file')).toBe('teams.errors.file')
  })

  it('teamFieldErrors place les erreurs sur les champs', () => {
    expect(teamFieldErrors(new ApiError(409, { error: 'team_name_taken' }))).toEqual({
      name: 'teams.errors.nameTaken',
    })
    expect(teamFieldErrors(new ApiError(400, { errors: { tag: 'x', game_id: 'y' } }))).toEqual({
      tag: 'teams.validation.tag',
      game_id: 'teams.validation.game',
    })
    expect(teamFieldErrors(new ApiError(403, {}))).toBeNull()
  })
})
