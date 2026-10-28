import {
  changedGameFields,
  validateGame,
} from '../src/features/games/validation';
const valid = { name: '  Catalog entry  ', description: '', images: [] };
it('accepts trimmed names, optional empty fields and exactly 10 images', () => {
  expect(validateGame(valid)).toEqual({});
  expect(
    validateGame({
      ...valid,
      name: '🎮'.repeat(64),
      description: 'é'.repeat(2000),
      images: Array(10).fill('HTTPS://example.org/a'),
    }),
  ).toEqual({});
});
it.each(['', '   ', 'a'.repeat(65)])('rejects invalid name length', (name) =>
  expect(validateGame({ ...valid, name }).name).toBe('games.validation.name'),
);
it('rejects descriptions longer than 2000 Unicode scalars', () =>
  expect(
    validateGame({ ...valid, description: '🎮'.repeat(2001) }).description,
  ).toBe('games.validation.description'));
it.each([
  'ftp://example.org/a',
  'https://',
  'https://example.org/a b',
  'https://example.org/\n',
  'https://example.org/' + 'é'.repeat(1024),
])('rejects an invalid image URL', (url) =>
  expect(validateGame({ ...valid, images: [url] }).images).toBe(
    'games.validation.images',
  ),
);
it('rejects more than 10 images', () =>
  expect(
    validateGame({ ...valid, images: Array(11).fill('http://example.org') })
      .images,
  ).toBe('games.validation.images'));
it('patches only changed fields, including explicit clearing and image order', () => {
  const original = {
    name: 'Catalog entry',
    description: 'Description',
    images: ['https://a.org', 'https://b.org'],
  };
  expect(
    changedGameFields(original, { ...original, name: ' Catalog entry ' }),
  ).toEqual({});
  expect(
    changedGameFields(original, {
      ...original,
      description: '',
      images: [...original.images].reverse(),
    }),
  ).toEqual({ description: '', images: ['https://b.org', 'https://a.org'] });
});
