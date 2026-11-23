import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import type { Stat } from '@/features/stats/types'
import { useI18n } from '@/i18n/context'

// Champ d'une statistique de participant : nombre (valeur brute ou pourcentage) ou liste des
// valeurs configurées pour le jeu (choix). Une valeur enregistrée puis retirée reste affichée,
// signalée comme indisponible.
export function StatInput({
  id,
  stat,
  label,
  value,
  invalid,
  disabled,
  onChange,
}: {
  id: string
  stat: Stat
  // Libellé accessible déjà traduit (statistique et participant).
  label: string
  value: string
  invalid?: boolean
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  const describedBy = invalid ? `${id}-error` : undefined
  if (stat.type === 'select') {
    const options = stat.options ?? []
    const removed = value !== '' && !options.some((option) => option.key === value)
    return (
      <NativeSelect
        id={id}
        className="min-w-36"
        aria-label={label}
        value={value}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t('matches.games.unset')}</option>
        {removed ? <option value={value}>{t('matches.games.unavailableOption', { value })}</option> : null}
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    )
  }
  return (
    <Input
      id={id}
      inputMode="decimal"
      className="w-28"
      aria-label={label}
      value={value}
      disabled={disabled}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
