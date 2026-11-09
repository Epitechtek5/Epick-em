import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { en } from './en'
import { fr, type Messages } from './fr'
import { I18nContext, type I18nValue, type Lang, type MessageKey, type Params } from './context'
import { translate } from './translate'

const STORAGE_KEY = 'epickem-lang'
const DICTIONARIES: Record<Lang, Messages> = { fr, en }

function readInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'fr' || stored === 'en') return stored
  } catch {
    // stockage indisponible : langue par défaut
  }
  return 'fr'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // préférence non persistée
    }
  }, [])

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang,
      t: (key: MessageKey, params?: Params) => translate(DICTIONARIES[lang], key, params),
    }),
    [lang, setLang],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
