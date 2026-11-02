import { GameController03Icon } from '@hugeicons/core-free-icons'
import { useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'

interface GameImageProps {
  src?: string
  name: string
  className?: string
}

// Image principale ; tuile de repli (fond muted + icône manette) quand il n'y a pas
// d'image ou qu'elle ne se charge pas — même D.A que l'application mobile.
export function GameImage({ src, name, className }: GameImageProps) {
  const { t } = useI18n()
  const [failed, setFailed] = useState<string | null>(null)
  const broken = !src || failed === src

  if (broken) {
    return (
      <div
        role="img"
        aria-label={src ? t('games.imageUnavailable', { name }) : t('games.noImage')}
        className={cn(
          'flex aspect-video items-center justify-center bg-muted text-muted-foreground',
          className,
        )}
      >
        <Icon icon={GameController03Icon} size={40} />
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={t('games.image', { name })}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className={cn('aspect-video w-full bg-muted object-cover', className)}
    />
  )
}
