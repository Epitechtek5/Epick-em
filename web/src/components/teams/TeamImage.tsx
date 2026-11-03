import { UserGroupIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'

interface TeamImageProps {
  src?: string | null
  name: string
  className?: string
}

// Photo de profil de l'équipe ; tuile de repli (fond muted + icône groupe) sans photo ou
// si elle ne se charge pas.
export function TeamImage({ src, name, className }: TeamImageProps) {
  const { t } = useI18n()
  const [failed, setFailed] = useState<string | null>(null)
  const broken = !src || failed === src

  if (broken) {
    return (
      <div
        role="img"
        aria-label={src ? t('teams.pictureUnavailable', { name }) : t('teams.noPicture', { name })}
        className={cn(
          'flex aspect-square shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground',
          className,
        )}
      >
        <Icon icon={UserGroupIcon} size={32} />
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={t('teams.picture', { name })}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className={cn('aspect-square shrink-0 rounded-xl bg-muted object-cover', className)}
    />
  )
}
