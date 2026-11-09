import { useCallback, useEffect, useRef, useState } from 'react'

import type { MessageKey } from '@/i18n/context'
import type { FieldErrors } from '@/lib/validation/auth'
import type { ErrorSummaryItem } from './ErrorSummary'

// État d'erreur commun aux formulaires d'authentification : erreurs par champ et erreur
// globale (clés de traduction), focus placé sur le résumé après chaque échec (WCAG 3.3.1).
export function useFormErrors<F extends string>() {
  const summaryRef = useRef<HTMLDivElement>(null)
  const [errors, setErrors] = useState<FieldErrors<F>>({})
  const [formError, setFormError] = useState<MessageKey | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (version > 0) summaryRef.current?.focus()
  }, [version])

  const fail = useCallback((fieldErrors: FieldErrors<F>, message: MessageKey | null = null) => {
    setErrors(fieldErrors)
    setFormError(message)
    setVersion((current) => current + 1)
  }, [])

  const clear = useCallback(() => {
    setErrors({})
    setFormError(null)
  }, [])

  // Retire l'erreur d'un champ dès qu'il est modifié.
  const clearField = useCallback((field: F) => {
    setErrors((current) => {
      if (!(field in current)) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }, [])

  const summaryItems = (
    fieldIds: Record<F, string>,
    translate: (key: MessageKey) => string,
  ): ErrorSummaryItem[] => [
    ...(Object.keys(fieldIds) as F[]).flatMap((field) => {
      const key = errors[field]
      return key ? [{ fieldId: fieldIds[field], message: translate(key) }] : []
    }),
    ...(formError ? [{ message: translate(formError) }] : []),
  ]

  return { summaryRef, errors, formError, fail, clear, clearField, summaryItems }
}
