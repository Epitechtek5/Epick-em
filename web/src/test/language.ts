import { screen } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'

import { languageName } from '@/i18n/language-names'
import type { Lang } from '@/i18n/context'

// Choisit une langue dans le menu de l'en-tête (bouton « Langue : … » puis l'option).
export async function chooseLanguage(user: UserEvent, lang: Lang) {
  await user.click(screen.getByRole('button', { name: /^(Langue|Language|Idioma)/ }))
  await user.click(screen.getByRole('menuitemradio', { name: languageName(lang) }))
}
