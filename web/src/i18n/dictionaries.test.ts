import { en } from './en'
import { es } from './es'
import { fr } from './fr'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([key, value]) =>
      typeof value === 'string'
        ? [[`${prefix}${key}`, value]]
        : Object.entries(flatten(value, `${prefix}${key}.`)),
    ),
  )
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

const reference = flatten(fr as unknown as Tree)

describe.each([
  ['en', en],
  ['es', es],
])('dictionnaire %s', (_, messages) => {
  const flat = flatten(messages as unknown as Tree)

  it('a exactement les clés du français, toutes renseignées', () => {
    expect(Object.keys(flat).sort()).toEqual(Object.keys(reference).sort())
    for (const [key, value] of Object.entries(flat)) expect(value.trim(), key).not.toBe('')
  })

  it('garde les mêmes variables {…} que le français', () => {
    for (const [key, value] of Object.entries(reference)) {
      expect(placeholders(flat[key]), key).toEqual(placeholders(value))
    }
  })
})
