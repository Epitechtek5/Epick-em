import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
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
      {dark ? 'Passer en mode clair' : 'Passer en mode sombre'}
    </Button>
  )
}
