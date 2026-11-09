import { Link } from 'react-router'

import { Card, CardContent } from '@/components/ui/card'
import { useI18n } from '@/i18n/context'
import { TeamImage } from './TeamImage'

interface TeamCardProps {
  to: string
  name: string
  tag: string | null
  pictureUrl: string | null
  // Libellés déjà résolus (nom du jeu, nom du propriétaire) ; absents pendant le chargement.
  gameName?: string
  ownerName?: string
  owned?: boolean
}

export function TeamCard({ to, name, tag, pictureUrl, gameName, ownerName, owned }: TeamCardProps) {
  const { t } = useI18n()
  return (
    <Card className="relative h-full transition-shadow focus-within:ring-2 focus-within:ring-ring hover:ring-2 hover:ring-primary/40">
      <CardContent className="flex items-start gap-3">
        <TeamImage src={pictureUrl} name={name} className="size-16" />
        <div className="grid min-w-0 gap-1">
          <h2 className="text-base font-semibold">
            <Link to={to} className="outline-none after:absolute after:inset-0 after:rounded-xl">
              {name}
            </Link>
          </h2>
          <dl className="grid gap-0.5 text-sm text-muted-foreground">
            {tag ? (
              <div className="flex gap-1">
                <dt>{t('teams.tag')} :</dt>
                <dd className="font-mono">{tag}</dd>
              </div>
            ) : null}
            {gameName !== undefined ? (
              <div className="flex gap-1">
                <dt>{t('teams.game')} :</dt>
                <dd className="truncate">{gameName}</dd>
              </div>
            ) : null}
            <div className="flex gap-1">
              <dt>{t('teams.owner')} :</dt>
              <dd className="truncate">
                {ownerName ?? t('teams.unknownUser')}
                {owned ? ` (${t('teams.you')})` : ''}
              </dd>
            </div>
          </dl>
        </div>
      </CardContent>
    </Card>
  )
}
