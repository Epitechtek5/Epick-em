import { Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons'
import { useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { useSettings } from '@/features/settings/context'
import { useI18n } from '@/i18n/context'
import { themeStore } from '@/lib/theme/theme-store'

// Bascule rapide clair/sombre de l'en-tête (icône du thème proposé). Le choix complet
// (dont « système ») se fait dans les réglages du compte ; connecté, la bascule y est aussi
// enregistrée.
export function ThemeToggle() {
  const { t } = useI18n()
  const { setTheme } = useSettings()
  const resolved = useSyncExternalStore(themeStore.subscribe, themeStore.resolved)
  const dark = resolved === 'dark'
  const label = dark ? t('shell.lightMode') : t('shell.darkMode')

  return (
    <Button
      variant="ghost"
      size="icon-lg"
      aria-label={label}
      title={label}
      aria-pressed={dark}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <Icon icon={dark ? Sun03Icon : Moon02Icon} size={18} />
    </Button>
  )
}
