import { useI18n, type Lang } from './context'

const OPTIONS: Lang[] = ['fr', 'en']

// Sélecteur natif : accessible au clavier et aux lecteurs d'écran sans surcouche.
export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n()
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="language-select" className="sr-only">
        {t('common.language')}
      </label>
      <select
        id="language-select"
        value={lang}
        onChange={(event) => setLang(event.target.value as Lang)}
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      >
        {OPTIONS.map((option) => (
          <option key={option} value={option} lang={option}>
            {option === 'fr' ? t('common.french') : t('common.english')}
          </option>
        ))}
      </select>
    </div>
  )
}
