import { HugeiconsIcon } from '@hugeicons/react'
import type { ComponentProps } from 'react'

type IconProps = Omit<ComponentProps<typeof HugeiconsIcon>, 'altIcon'>

// Icônes décoratives (hugeicons) : masquées aux lecteurs d'écran, le libellé
// accessible est toujours porté par le texte du bouton ou du lien.
export function Icon(props: IconProps) {
  return <HugeiconsIcon size={16} strokeWidth={1.75} aria-hidden="true" {...props} />
}
