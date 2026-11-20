import { useState } from 'react'

import { cn } from '@/lib/utils'
import { initials } from './initials'

const SIZES = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-16 text-xl',
} as const

interface UserAvatarProps {
  src?: string | null
  name: string
  size?: keyof typeof SIZES
  className?: string
  // Décoratif quand le nom est déjà écrit à côté (évite une double annonce).
  decorative?: boolean
}

// Photo de profil d'un compte ; initiales si le compte n'en a pas ou si elle ne se
// charge pas (même repli que l'application mobile, components/users/user-avatar.tsx).
export function UserAvatar({ src, name, size = 'md', className, decorative = false }: UserAvatarProps) {
  const [failed, setFailed] = useState<string | null>(null)
  const frame = cn('shrink-0 rounded-full bg-muted', SIZES[size], className)
  const usable = src && failed !== src && /^https?:\/\//i.test(src)

  if (!usable) {
    return (
      <span
        role={decorative ? undefined : 'img'}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : name}
        className={cn(frame, 'inline-flex items-center justify-center font-semibold text-primary select-none')}
      >
        {initials(name)}
      </span>
    )
  }

  return (
    <img
      src={src}
      alt={decorative ? '' : name}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className={cn(frame, 'object-cover')}
    />
  )
}
