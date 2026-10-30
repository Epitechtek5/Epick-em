import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router'

import { useI18n } from '@/i18n/context'
import { AppHeader } from './AppHeader'

// Structure commune : lien d'évitement, en-tête, zone principale. À chaque
// changement de page, le focus revient sur la zone principale (navigation SPA).
export function AppShell() {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const firstRender = useRef(true)

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    mainRef.current?.focus()
  }, [pathname])

  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#contenu"
        className="sr-only rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10"
        onClick={(event) => {
          event.preventDefault()
          mainRef.current?.focus()
        }}
      >
        {t('common.openMainContent')}
      </a>
      <AppHeader />
      <main
        id="contenu"
        ref={mainRef}
        tabIndex={-1}
        className="flex flex-1 items-center justify-center p-6 outline-none"
      >
        <Outlet />
      </main>
    </div>
  )
}
