import { Add01Icon, ArrowDown01Icon, ArrowUp01Icon, Delete02Icon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { fieldTypeLabelKey } from '@/features/tournaments/labels'
import { FIELD_TYPES, type FieldType, type RegistrationField } from '@/features/tournaments/types'
import {
  FIELD_KEY_MAX,
  FIELD_LABEL_MAX,
  FIELDS_MAX,
  invalidFieldIndex,
  OPTIONS_MAX,
  suggestFieldKey,
} from '@/features/tournaments/validation'
import { useI18n } from '@/i18n/context'

interface RegistrationFieldsEditorProps {
  id: string
  fields: RegistrationField[]
  onChange: (fields: RegistrationField[]) => void
  describedBy?: string
  invalid?: boolean
}

// Champs d'inscription personnalisés (pseudo en jeu, rang, plateforme…) : libellé, clé de la
// réponse, type, caractère obligatoire et options d'une liste. Les règles sont celles du serveur.
export function RegistrationFieldsEditor({ id, fields, onChange, describedBy, invalid }: RegistrationFieldsEditorProps) {
  const { t } = useI18n()
  const firstInvalid = invalid ? invalidFieldIndex(fields) : null

  const update = (index: number, patch: Partial<RegistrationField>) =>
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)))
  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= fields.length) return
    const next = [...fields]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }
  const add = () =>
    onChange([
      ...fields,
      {
        key: suggestFieldKey('', fields.map((field) => field.key)),
        label: '',
        field_type: 'text',
        required: false,
        options: [],
      },
    ])

  return (
    <div id={id} className="grid gap-3" aria-describedby={describedBy}>
      {fields.length === 0 ? <p className="text-sm text-muted-foreground">{t('tournaments.fields.empty')}</p> : null}
      <ol className="grid gap-3" aria-label={t('tournaments.fields.list')}>
        {fields.map((field, index) => {
          const prefix = `${id}-${index}`
          const others = fields.filter((_, i) => i !== index).map((other) => other.key)
          const name = field.label.trim() || t('tournaments.fields.untitled', { n: index + 1 })
          return (
            <li
              key={index}
              aria-invalid={firstInvalid === index ? true : undefined}
              className="grid gap-3 rounded-xl bg-muted/40 p-4 ring-1 ring-foreground/10 ring-inset aria-invalid:ring-2 aria-invalid:ring-destructive"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label htmlFor={`${prefix}-label`}>{t('tournaments.fields.label')}</Label>
                  <Input
                    id={`${prefix}-label`}
                    value={field.label}
                    maxLength={FIELD_LABEL_MAX}
                    onChange={(event) => {
                      const label = event.target.value
                      // La clé suit le libellé tant qu'elle n'a pas été modifiée à la main.
                      const auto = field.key === suggestFieldKey(field.label, others)
                      update(index, auto ? { label, key: suggestFieldKey(label, others) } : { label })
                    }}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`${prefix}-key`}>{t('tournaments.fields.key')}</Label>
                  <Input
                    id={`${prefix}-key`}
                    value={field.key}
                    maxLength={FIELD_KEY_MAX}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    aria-describedby={`${id}-key-hint`}
                    onChange={(event) => update(index, { key: event.target.value })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`${prefix}-type`}>{t('tournaments.fields.typeLabel')}</Label>
                  <NativeSelect
                    id={`${prefix}-type`}
                    value={field.field_type}
                    onChange={(event) => {
                      const type = event.target.value as FieldType
                      update(index, { field_type: type, options: type === 'select' ? field.options : [] })
                    }}
                  >
                    {FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(fieldTypeLabelKey(type))}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={field.required}
                    onChange={(event) => update(index, { required: event.target.checked })}
                  />
                  {t('tournaments.fields.required')}
                </label>
              </div>
              {field.field_type === 'select' ? (
                <div className="grid gap-1">
                  <Label htmlFor={`${prefix}-options`}>{t('tournaments.fields.options')}</Label>
                  <Textarea
                    id={`${prefix}-options`}
                    value={field.options.join('\n')}
                    aria-describedby={`${prefix}-options-hint`}
                    onChange={(event) =>
                      update(index, { options: event.target.value.split('\n').filter((line, i, all) => line !== '' || i < all.length - 1) })
                    }
                  />
                  <p id={`${prefix}-options-hint`} className="text-sm text-muted-foreground">
                    {t('tournaments.fields.optionsHint', { max: OPTIONS_MAX })}
                  </p>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={index === 0}
                  aria-label={t('tournaments.fields.moveUp', { name })}
                  onClick={() => move(index, -1)}
                >
                  <Icon icon={ArrowUp01Icon} />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={index === fields.length - 1}
                  aria-label={t('tournaments.fields.moveDown', { name })}
                  onClick={() => move(index, 1)}
                >
                  <Icon icon={ArrowDown01Icon} />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t('tournaments.fields.remove', { name })}
                  onClick={() => onChange(fields.filter((_, i) => i !== index))}
                >
                  <Icon icon={Delete02Icon} />
                  {t('tournaments.fields.removeShort')}
                </Button>
              </div>
            </li>
          )
        })}
      </ol>
      <p id={`${id}-key-hint`} className="text-sm text-muted-foreground">
        {t('tournaments.fields.keyHint', { max: FIELD_KEY_MAX })}
      </p>
      <div>
        <Button type="button" variant="outline" size="sm" disabled={fields.length >= FIELDS_MAX} onClick={add}>
          <Icon icon={Add01Icon} />
          {t('tournaments.fields.add')}
        </Button>
      </div>
    </div>
  )
}
