import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'

export function ThemeToggle() {
  const { t } = useI18n()
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('epickem-theme') !== 'light'
    } catch {
      return true
    }
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    try {
      localStorage.setItem('epickem-theme', dark ? 'dark' : 'light')
    } catch {
      // Le thème reste utilisable lorsque le stockage est désactivé.
    }
  }, [dark])

  return (
    <Button variant="outline" size="sm" aria-pressed={dark} onClick={() => setDark(!dark)}>
      {dark ? t('shell.lightMode') : t('shell.darkMode')}
    </Button>
  )
}
