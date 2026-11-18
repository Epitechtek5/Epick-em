import { ArrowLeft01Icon, Search01Icon } from '@hugeicons/core-free-icons'
import { Link } from 'react-router'

import { HERO_BACK, PageHero } from '@/components/common/page-blocks'
import { Icon } from '@/components/ui/icon'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n } from '@/i18n/context'

export default function NotFoundPage() {
  const { t } = useI18n()
  useDocumentTitle(t('notFound.title'))

  return (
    <div className="grid w-full max-w-6xl gap-6 self-start">
      <PageHero
        icon={Search01Icon}
        title={t('notFound.title')}
        description={t('notFound.description')}
        back={
          <Link to="/" className={HERO_BACK}>
            <Icon icon={ArrowLeft01Icon} size={16} />
            {t('notFound.home')}
          </Link>
        }
      />
    </div>
  )
}
