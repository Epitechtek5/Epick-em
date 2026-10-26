import type { ReactNode } from 'react'

import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'

interface DashboardSectionProps {
  id: string
  title: string
  description: string
  // Contenu réel ; absent tant que l'API correspondante n'est pas disponible.
  children?: ReactNode
  emptyMessage: string
}

// Bloc du tableau de bord. L'état « bientôt disponible » est dit en toutes lettres
// (jamais par la couleur seule).
export function DashboardSection({
  id,
  title,
  description,
  children,
  emptyMessage,
}: DashboardSectionProps) {
  const headingId = `${id}-title`

  return (
    <section aria-labelledby={headingId}>
      <Card className="h-full">
        <CardHeader>
          <h2 id={headingId} className="text-lg leading-none font-semibold">
            {title}
          </h2>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          {children ?? (
            <div className="grid gap-1 rounded-lg border border-dashed border-muted-foreground/60 p-4 text-sm">
              <p className="font-medium">Bientôt disponible</p>
              <p className="text-muted-foreground">{emptyMessage}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
