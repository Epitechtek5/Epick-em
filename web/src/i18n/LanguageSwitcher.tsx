import { ArrowDown01Icon, LanguageCircleIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import { Icon } from '@/components/ui/icon'
import { useSettings } from '@/features/settings/context'
import { cn } from '@/lib/utils'
import { LANGS, useI18n, type Lang } from './context'
import { languageName } from './language-names'

// Menu de langue de l'en-tête (bouton + liste en carte, aux couleurs du thème, lisible en
// sombre comme en clair). Motif « menu button » : flèches, Origine/Fin, Échap et clic
// extérieur ; le focus revient au bouton à la fermeture. Connecté, le choix est aussi
// enregistré dans les réglages du compte.
export function LanguageSwitcher() {
  const { lang, t } = useI18n()
  const { setLanguage } = useSettings()
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const close = (focusButton: boolean) => {
    setOpen(false)
    if (focusButton) buttonRef.current?.focus()
  }

  // À l'ouverture, le focus va sur la langue courante.
  useEffect(() => {
    if (!open) return
    itemRefs.current[Math.max(0, LANGS.indexOf(lang))]?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, lang])

  const choose = (next: Lang) => {
    close(true)
    if (next !== lang) setLanguage(next)
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null)
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const focus = (index: number) => items[(index + items.length) % items.length]?.focus()
    if (event.key === 'ArrowDown') focus(current + 1)
    else if (event.key === 'ArrowUp') focus(current - 1)
    else if (event.key === 'Home') focus(0)
    else if (event.key === 'End') focus(items.length - 1)
    else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault()
      close(event.key === 'Escape')
      return
    } else return
    event.preventDefault()
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${t('common.language')}${t('common.colon')} ${languageName(lang)}`}
        title={t('common.language')}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50',
          open && 'bg-accent',
        )}
      >
        <Icon icon={LanguageCircleIcon} size={18} />
        <span className="uppercase">{lang}</span>
        <Icon icon={ArrowDown01Icon} size={14} className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t('common.language')}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-30 mt-2 grid w-44 gap-0.5 rounded-xl bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95"
        >
          {LANGS.map((option, index) => {
            const selected = option === lang
            return (
              <button
                key={option}
                ref={(element) => {
                  itemRefs.current[index] = element
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                lang={option}
                tabIndex={-1}
                onClick={() => choose(option)}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent',
                  selected && 'font-semibold text-primary dark:text-violet-200',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-md text-xs font-bold uppercase',
                    selected ? 'bg-primary/10 text-primary dark:bg-primary/25 dark:text-violet-200' : 'bg-muted text-foreground/70',
                  )}
                >
                  {option}
                </span>
                <span className="flex-1">{languageName(option)}</span>
                {selected ? <Icon icon={Tick02Icon} size={16} /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
