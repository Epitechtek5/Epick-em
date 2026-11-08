import { Link } from 'react-router'

import { Card, CardContent } from '@/components/ui/card'
import { useI18n } from '@/i18n/context'
import type { Game } from '@/features/games/types'
import { GameImage } from './GameImage'

export function GameCard({ game }: { game: Game }) {
  const { t } = useI18n()
  return (
    <Card className="relative h-full transition-shadow focus-within:ring-2 focus-within:ring-ring hover:ring-2 hover:ring-primary/40">
      <GameImage src={game.images[0]} name={game.name} className="-mt-(--card-spacing)" />
      <CardContent className="grid gap-1">
        <h2 className="text-base font-semibold">
          <Link
            to={`/games/${game.id}`}
            className="outline-none after:absolute after:inset-0 after:rounded-xl"
          >
            {game.name}
          </Link>
        </h2>
        <p className="line-clamp-3 text-sm text-muted-foreground">
          {game.description || t('games.noDescription')}
        </p>
      </CardContent>
    </Card>
  )
}
