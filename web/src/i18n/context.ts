import { createContext, useContext } from 'react'

import { fr, type Messages } from './fr'
import { translate, type Params } from './translate'

export type Lang = 'fr' | 'en'

type Join<K extends string, P extends string> = `${K}.${P}`
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : Join<K, Paths<T[K]>>
}[keyof T & string]

export type MessageKey = Paths<Messages>
export type { Params }

export interface I18nValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: MessageKey, params?: Params) => string
}

// Sans fournisseur (tests de composants isolés), le français est la langue par défaut.
const DEFAULT_VALUE: I18nValue = {
  lang: 'fr',
  setLang: () => {},
  t: (key, params) => translate(fr, key, params),
}

export const I18nContext = createContext<I18nValue>(DEFAULT_VALUE)

export function useI18n(): I18nValue {
  return useContext(I18nContext)
}
