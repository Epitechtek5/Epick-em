import { ArrowLeft01Icon, SquareLock02Icon } from '@hugeicons/core-free-icons'
import { Link, Outlet } from 'react-router'

import { HERO_BACK, PageHero } from '@/components/common/page-blocks'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { Icon } from '@/components/ui/icon'
import { useI18n } from '@/i18n/context'
import { useAuth } from '@/lib/auth/auth-context'

function Forbidden() {
  const { t } = useI18n()
  useDocumentTitle(t('admin.forbiddenTitle'))
  return (
    <div className="grid w-full max-w-6xl gap-3 self-start">
      <PageHero
        icon={SquareLock02Icon}
        title={t('admin.forbiddenTitle')}
        description={t('admin.forbiddenText')}
        back={
          <Link to="/games" className={HERO_BACK}>
            <Icon icon={ArrowLeft01Icon} size={16} />
            {t('games.returnToCatalog')}
          </Link>
        }
      />
    </div>
  )
}

// Garde d'interface pour les écrans d'administration. Elle n'est qu'un confort :
// le serveur reste l'autorité (403 si le rôle n'est pas admin).
export function AdminRoute() {
  const { isAdmin } = useAuth()
  return isAdmin ? <Outlet /> : <Forbidden />
}
