import type { Messages } from './fr'

export type Params = Record<string, string | number>

export function translate(messages: Messages, key: string, params?: Params): string {
  let node: unknown = messages
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return key
    node = (node as Record<string, unknown>)[part]
  }
  if (typeof node !== 'string') return key
  if (!params) return node
  return node.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}
