import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import type { RegistrationField } from '@/features/tournaments/types'
import { ANSWER_MAX, type ResponseError, type ResponseValues } from '@/features/tournaments/validation'
import { useI18n, type MessageKey } from '@/i18n/context'

const ERRORS: Record<ResponseError, MessageKey> = {
  required: 'tournaments.participants.answer.required',
  number: 'tournaments.participants.answer.number',
  option: 'tournaments.participants.answer.option',
  tooLong: 'tournaments.participants.answer.tooLong',
}

// Champs d'inscription définis par les organisateurs, rendus selon leur type.
export function RegistrationFieldInputs({
  fields,
  values,
  errors,
  onChange,
}: {
  fields: readonly RegistrationField[]
  values: ResponseValues
  errors: Partial<Record<string, ResponseError>>
  onChange: (key: string, value: string | boolean) => void
}) {
  const { t } = useI18n()
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-2 text-sm font-medium">{t('tournaments.participants.answersTitle')}</legend>
      {fields.map((field) => {
        const id = `register-field-${field.key}`
        const error = errors[field.key]
        const errorId = error ? `${id}-error` : undefined
        const label = field.required ? field.label : t('tournaments.participants.optionalField', { label: field.label })
        const message = error ? (
          <p id={errorId} className="text-sm text-destructive">
            <span className="font-medium">{t('common.error')}</span> {t(ERRORS[error], { max: ANSWER_MAX })}
          </p>
        ) : null
        if (field.field_type === 'boolean') {
          return (
            <div key={field.key} className="grid gap-1">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  id={id}
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={values[field.key] === true}
                  required={field.required}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={errorId}
                  onChange={(event) => onChange(field.key, event.target.checked)}
                />
                {label}
              </label>
              {message}
            </div>
          )
        }
        const value = typeof values[field.key] === 'string' ? (values[field.key] as string) : ''
        return (
          <div key={field.key} className="grid gap-1">
            <Label htmlFor={id}>{label}</Label>
            {field.field_type === 'select' ? (
              <NativeSelect
                id={id}
                value={value}
                required={field.required}
                aria-invalid={error ? true : undefined}
                aria-describedby={errorId}
                onChange={(event) => onChange(field.key, event.target.value)}
              >
                <option value="">{t('tournaments.participants.chooseOption')}</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input
                id={id}
                value={value}
                inputMode={field.field_type === 'number' ? 'decimal' : undefined}
                maxLength={field.field_type === 'text' ? ANSWER_MAX : undefined}
                required={field.required}
                aria-invalid={error ? true : undefined}
                aria-describedby={errorId}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            )}
            {message}
          </div>
        )
      })}
    </fieldset>
  )
}
