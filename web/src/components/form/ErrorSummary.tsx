import { forwardRef } from 'react'

export interface ErrorSummaryItem {
  fieldId?: string
  message: string
}

interface ErrorSummaryProps {
  items: ErrorSummaryItem[]
}

// Résumé annoncé par les lecteurs d'écran ; reçoit le focus après une soumission
// en erreur. Chaque erreur de champ est un lien qui place le focus sur le champ.
export const ErrorSummary = forwardRef<HTMLDivElement, ErrorSummaryProps>(
  function ErrorSummary({ items }, ref) {
    if (items.length === 0) return null

    return (
      <div
        ref={ref}
        role="alert"
        tabIndex={-1}
        aria-labelledby="error-summary-title"
        className="rounded-lg border border-destructive p-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <h2 id="error-summary-title" className="mb-2 font-semibold text-destructive">
          {items.length === 1
            ? 'Une erreur a été détectée'
            : `${items.length} erreurs ont été détectées`}
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          {items.map((item) => (
            <li key={`${item.fieldId ?? 'form'}-${item.message}`}>
              {item.fieldId ? (
                <a
                  href={`#${item.fieldId}`}
                  className="underline underline-offset-2"
                  onClick={(event) => {
                    event.preventDefault()
                    document.getElementById(item.fieldId!)?.focus()
                  }}
                >
                  {item.message}
                </a>
              ) : (
                item.message
              )}
            </li>
          ))}
        </ul>
      </div>
    )
  },
)
