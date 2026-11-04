import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
  // Texte secondaire affiché sous le libellé (ex. clé d'une statistique) ; aussi recherché.
  hint?: string
}

interface SearchableSelectProps {
  id: string
  options: readonly SelectOption[]
  value: string
  onChange: (value: string) => void
  // Option « vide » proposée en tête (ex. « Tous les jeux ») ; sans elle, aucune option vide.
  emptyLabel?: string
  placeholder?: string
  noResultsLabel: string
  disabled?: boolean
  required?: boolean
  className?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

function normalize(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

// Liste déroulante filtrable (motif « combobox » WAI-ARIA 1.2, autocomplétion en liste) : la saisie
// filtre les options, flèches haut / bas pour parcourir, Entrée pour choisir, Échap pour fermer.
// Quitter le champ sans choisir rétablit la valeur sélectionnée.
export function SearchableSelect({
  id,
  options,
  value,
  onChange,
  emptyLabel,
  placeholder,
  noResultsLabel,
  disabled,
  required,
  className,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: SearchableSelectProps) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const all = useMemo<SelectOption[]>(
    () => (emptyLabel === undefined ? [...options] : [{ value: '', label: emptyLabel }, ...options]),
    [options, emptyLabel],
  )
  const selected = all.find((option) => option.value === value)
  // Texte saisi pendant la recherche ; fermé, le champ affiche toujours l'option choisie
  // (y compris quand la valeur change de l'extérieur : URL, réinitialisation).
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [filtering, setFiltering] = useState(false)
  const [active, setActive] = useState(0)
  const shown = open ? text : (selected?.label ?? '')

  const query = filtering ? normalize(text.trim()) : ''
  const visible = query
    ? all.filter((option) => normalize(`${option.label} ${option.hint ?? ''}`).includes(query))
    : all

  function show() {
    if (disabled) return
    setText(selected?.label ?? '')
    setOpen(true)
    setFiltering(false)
    setActive(Math.max(0, all.findIndex((option) => option.value === value)))
  }

  function close() {
    setOpen(false)
    setFiltering(false)
  }

  function choose(option: SelectOption) {
    setOpen(false)
    setFiltering(false)
    if (option.value !== value) onChange(option.value)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        show()
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((index) => (visible.length === 0 ? 0 : (index + step + visible.length) % visible.length))
    } else if (event.key === 'Enter') {
      if (open) {
        event.preventDefault()
        const option = visible[active]
        if (option) choose(option)
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        close()
      }
    } else if (event.key === 'Home' && open) {
      setActive(0)
    } else if (event.key === 'End' && open) {
      setActive(Math.max(0, visible.length - 1))
    }
  }

  const activeOption = open ? visible[active] : undefined
  const optionId = (index: number) => `${listId}-option-${index}`

  return (
    <div className={cn('relative min-w-0', className)}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeOption ? optionId(active) : undefined}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-required={required || undefined}
        disabled={disabled}
        placeholder={placeholder}
        value={shown}
        onFocus={(event) => {
          show()
          // Le libellé choisi est sélectionné : la saisie le remplace.
          const input = event.currentTarget
          requestAnimationFrame(() => input.select())
        }}
        onClick={() => (open ? undefined : show())}
        onBlur={close}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          setText(event.target.value)
          setFiltering(true)
          setActive(0)
          setOpen(true)
        }}
        className="h-8 w-full min-w-0 rounded-lg border border-input bg-background py-1 pr-8 pl-2.5 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:bg-input/30"
      />
      <Icon
        icon={ArrowDown01Icon}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
      />
      <ul
        id={listId}
        role="listbox"
        hidden={!open}
        className="absolute z-20 mt-1 max-h-64 w-full min-w-48 overflow-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
      >
        {visible.map((option, index) => (
          <li
            key={option.value || '__empty'}
            id={optionId(index)}
            role="option"
            aria-selected={option.value === value}
            // mousedown plutôt que click : le choix précède la perte de focus du champ.
            onMouseDown={(event) => {
              event.preventDefault()
              choose(option)
            }}
            onMouseEnter={() => setActive(index)}
            className={cn(
              'cursor-pointer rounded-md px-2 py-1.5 text-sm',
              index === active && 'bg-accent text-accent-foreground',
              option.value === value && 'font-medium',
            )}
          >
            {option.value === value ? <span aria-hidden="true">✓ </span> : null}
            {option.label}
            {option.hint ? <span className="block text-xs text-muted-foreground">{option.hint}</span> : null}
          </li>
        ))}
        {visible.length === 0 ? (
          <li role="presentation" className="px-2 py-1.5 text-sm text-muted-foreground">
            {noResultsLabel}
          </li>
        ) : null}
      </ul>
    </div>
  )
}
