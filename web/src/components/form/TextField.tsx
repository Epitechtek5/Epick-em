import type { ComponentProps } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface TextFieldProps extends Omit<ComponentProps<typeof Input>, 'id'> {
  id: string
  label: string
  hint?: string
  error?: string
}

// Libellé relié, aide et erreur liées au champ (aria-describedby), aria-invalid.
export function TextField({ id, label, hint, error, ...inputProps }: TextFieldProps) {
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          <span className="font-medium">Erreur :</span> {error}
        </p>
      ) : null}
    </div>
  )
}
