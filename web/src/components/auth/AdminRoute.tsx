import { Link, Outlet } from 'react-router'

import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n } from '@/i18n/context'
import { useAuth } from '@/lib/auth/auth-context'

function Forbidden() {
  const { t } = useI18n()
  useDocumentTitle(t('admin.forbiddenTitle'))
  return (
    <div className="grid w-full max-w-5xl gap-3 self-start">
      <h1 className="text-3xl font-semibold tracking-tight">{t('admin.forbiddenTitle')}</h1>
      <p className="text-muted-foreground">{t('admin.forbiddenText')}</p>
      <p>
        <Link to="/games" className="text-primary underline underline-offset-4">
          {t('games.returnToCatalog')}
        </Link>
      </p>
    </div>
  )
}

// Garde d'interface pour les écrans d'administration. Elle n'est qu'un confort :
// le serveur reste l'autorité (403 si le rôle n'est pas admin).
export function AdminRoute() {
  const { isAdmin } = useAuth()
  return isAdmin ? <Outlet /> : <Forbidden />
}
