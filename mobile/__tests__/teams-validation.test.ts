import {
  changedTeamFields,
  ownsTeam,
  teamId,
  validateTeam,
} from '../src/features/teams/validation';

const values = { name: 'Team', tag: '', picture_url: '' };
const id = '22222222-2222-4222-8222-222222222222';

it('validates names, tags and HTTP(S) URLs at backend limits', () => {
  expect(validateTeam(values)).toEqual({});
  expect(
    validateTeam({
      name: '🎮'.repeat(64),
      tag: 'ABCDEFGH',
      picture_url: 'https://example.com/team.png',
    }),
  ).toEqual({});
  expect(validateTeam({ ...values, name: '  ' }).name).toBeTruthy();
  expect(validateTeam({ ...values, name: 'x'.repeat(65) }).name).toBeTruthy();
  expect(validateTeam({ ...values, tag: '123456789' }).tag).toBeTruthy();
  expect(
    validateTeam({ ...values, picture_url: 'ftp://example.com/a' }).picture_url,
  ).toBeTruthy();
  expect(
    validateTeam({
      ...values,
      picture_url: `https://example.com/${'é'.repeat(1100)}`,
    }).picture_url,
  ).toBeTruthy();
});

it('patches only changed fields and sends empty strings to clear optional values', () => {
  expect(changedTeamFields(values, { ...values, name: ' Team ' })).toEqual({});
  expect(
    changedTeamFields(
      { name: 'Team', tag: 'T', picture_url: 'https://example.com/a' },
      values,
    ),
  ).toEqual({ tag: '', picture_url: '' });
});

it('separates ownership from application role and validates UUIDs', () => {
  expect(ownsTeam(id, id)).toBe(true);
  expect(ownsTeam(id, '33333333-3333-4333-8333-333333333333')).toBe(false);
  expect(ownsTeam(id)).toBe(false);
  expect(teamId(id)).toBe(id);
  expect(() => teamId('admin')).toThrow();
});
