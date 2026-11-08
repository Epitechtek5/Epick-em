import type { IconSvgElement } from '@hugeicons/react'
import type { ReactNode } from 'react'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

// Briques visuelles des écrans de tournois.

// Section en carte : en-tête avec pastille d'icône, titre (h2), sous-titre et actions.
export function SectionCard({
  id,
  icon,
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  id: string
  icon: IconSvgElement
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn('grid gap-4 rounded-2xl bg-card p-4 text-card-foreground shadow-sm ring-1 ring-foreground/10 sm:p-6', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary dark:bg-primary/25 dark:text-violet-200">
            <Icon icon={icon} size={20} />
          </span>
          <div className="grid min-w-0 gap-0.5">
            <h2 id={id} className="text-lg font-semibold tracking-tight">
              {title}
            </h2>
            {subtitle ? <div className="text-sm text-muted-foreground">{subtitle}</div> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

// Tuile de chiffre clé (libellé + valeur), dans une liste de définitions.
export function FactTile({ icon, label, children }: { icon: IconSvgElement; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground/70">
        <Icon icon={icon} size={18} />
      </span>
      <div className="grid min-w-0 gap-0.5">
        <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
        <dd className="text-sm font-semibold break-words">{children}</dd>
      </div>
    </div>
  )
}

const AVATAR_TONES = [
  'bg-violet-100 text-violet-800 dark:bg-violet-500/25 dark:text-violet-100',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/25 dark:text-emerald-100',
  'bg-sky-100 text-sky-800 dark:bg-sky-500/25 dark:text-sky-100',
  'bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100',
  'bg-rose-100 text-rose-800 dark:bg-rose-500/25 dark:text-rose-100',
  'bg-teal-100 text-teal-800 dark:bg-teal-500/25 dark:text-teal-100',
]

// Pastille d'initiales, teinte stable par nom ; décorative (le nom est écrit à côté).
export function Avatar({ name, className }: { name: string; className?: string }) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  const initials = name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toUpperCase())
    .join('')
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold',
        AVATAR_TONES[hash % AVATAR_TONES.length],
        className,
      )}
    >
      {initials || '?'}
    </span>
  )
}

// Petite pastille neutre (mode de barème, rôle…).
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground/80 ring-1 ring-foreground/10 ring-inset',
        className,
      )}
    >
      {children}
    </span>
  )
}

// État vide illustré.
export function EmptyState({ icon, children }: { icon: IconSvgElement; children: ReactNode }) {
  return (
    <div role="status" className="grid justify-items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      <span className="grid size-12 place-items-center rounded-full bg-muted">
        <Icon icon={icon} size={24} />
      </span>
      <p>{children}</p>
    </div>
  )
}

// Bandeau d'en-tête en dégradé (h1, description, lien de retour, actions éventuelles).
export function PageHero({
  icon,
  title,
  description,
  back,
  children,
}: {
  icon: IconSvgElement
  title: string
  description?: ReactNode
  back?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-violet-700 to-fuchsia-700 p-6 text-white shadow-lg sm:p-8">
      <div className="pointer-events-none absolute -top-16 -right-10 size-64 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 size-72 rounded-full bg-fuchsia-400/20 blur-3xl" aria-hidden="true" />
      <div className="relative grid gap-4">
        {back ? <div className="text-sm">{back}</div> : null}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex min-w-0 items-start gap-4">
            <span className="hidden size-14 shrink-0 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25 sm:grid">
              <Icon icon={icon} size={30} />
            </span>
            <div className="grid min-w-0 gap-2">
              <h1 className="text-3xl font-bold tracking-tight break-words sm:text-4xl">{title}</h1>
              {description ? <div className="max-w-2xl text-violet-100">{description}</div> : null}
            </div>
          </div>
          {children}
        </div>
      </div>
    </header>
  )
}

// Groupe de champs en carte : pastille d'icône et titre (légende), consigne éventuelle.
export function FormSection({
  icon,
  title,
  hint,
  children,
}: {
  icon: IconSvgElement
  title: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <fieldset className="grid min-w-0 gap-4 rounded-2xl bg-card p-4 text-card-foreground shadow-sm ring-1 ring-foreground/10 sm:p-6">
      <legend className="float-left flex w-full items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary dark:bg-primary/25 dark:text-violet-200">
          <Icon icon={icon} size={20} />
        </span>
        <span className="text-lg font-semibold tracking-tight">{title}</span>
      </legend>
      {hint}
      {children}
    </fieldset>
  )
}
