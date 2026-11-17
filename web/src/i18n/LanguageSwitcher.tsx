import { LanguageCircleIcon } from '@hugeicons/core-free-icons'

import { Icon } from '@/components/ui/icon'
import { useSettings } from '@/features/settings/context'
import { LANGS, useI18n, type Lang } from './context'
import { languageName } from './language-names'

// Sélecteur natif compact (icône + code de langue) : accessible au clavier et aux lecteurs
// d'écran sans surcouche. Connecté, le choix est aussi enregistré dans les réglages du compte.
export function LanguageSwitcher() {
  const { lang, t } = useI18n()
  const { setLanguage } = useSettings()
  return (
    <div
      className="relative flex h-9 items-center rounded-lg text-sm hover:bg-accent has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
      title={t('common.language')}
    >
      <Icon icon={LanguageCircleIcon} size={18} className="pointer-events-none absolute left-2" />
      <label htmlFor="language-select" className="sr-only">
        {t('common.language')}
      </label>
      <select
        id="language-select"
        value={lang}
        onChange={(event) => setLanguage(event.target.value as Lang)}
        className="h-9 cursor-pointer appearance-none rounded-lg bg-transparent pr-2 pl-8 text-sm font-medium outline-none"
      >
        {LANGS.map((option) => (
          <option key={option} value={option} lang={option}>
            {languageName(option)}
          </option>
        ))}
      </select>
    </div>
  )
}
