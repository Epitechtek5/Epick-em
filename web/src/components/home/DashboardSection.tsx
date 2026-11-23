import type { IconSvgElement } from '@hugeicons/react'
import type { ReactNode } from 'react'

import { SectionCard } from '@/components/common/page-blocks'
import { useI18n } from '@/i18n/context'

interface DashboardSectionProps {
  id: string
  icon: IconSvgElement
  title: string
  description: string
  // Contenu réel ; absent tant que l'API correspondante n'est pas disponible.
  children?: ReactNode
  emptyMessage: string
}

// Bloc du tableau de bord. L'état « bientôt disponible » est dit en toutes lettres
// (jamais par la couleur seule).
export function DashboardSection({ id, icon, title, description, children, emptyMessage }: DashboardSectionProps) {
  const { t } = useI18n()
  return (
    <SectionCard id={`${id}-title`} icon={icon} title={title} subtitle={description} className="h-full content-start">
      {children ?? (
        <div className="grid gap-1 rounded-xl border border-dashed px-4 py-6 text-center text-sm">
          <p className="font-medium">{t('home.comingSoon')}</p>
          <p className="text-muted-foreground">{emptyMessage}</p>
        </div>
      )}
    </SectionCard>
  )
}
