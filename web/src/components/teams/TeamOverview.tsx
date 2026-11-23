import { Edit02Icon, InformationCircleIcon, RefreshIcon, UserGroupIcon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { FactTile, HERO_ACTION, PageHero } from '@/components/common/page-blocks'
import { StateMessage } from '@/components/games/StateMessage'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { useI18n, type MessageKey } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { TeamImage } from './TeamImage'

interface TeamOverviewProps {
  name: string
  tag: string | null
  pictureUrl: string | null
  // Lignes de description supplémentaires (jeu, propriétaire, tournoi…), déjà traduites.
  details: Array<{ label: string; value: ReactNode; icon?: IconSvgElement }>
  // Lien de retour affiché dans le bandeau.
  back?: ReactNode
  canManage: boolean
  editTo: string
  deleteLabels: { label: string; busy: string; title: string; description: string }
  deleting: boolean
  deleteError: MessageKey | null
  onDelete: () => void
  onRefresh: () => void
}

// En-tête d'une fiche d'équipe (globale ou de tournoi), au style des pages de tournois :
// bandeau avec photo (repli), nom, tag et actions réservées au propriétaire (modifier,
// supprimer après confirmation), puis tuiles de détails.
export function TeamOverview(props: TeamOverviewProps) {
  const { t } = useI18n()
  return (
    <article className="grid gap-4" aria-labelledby="team-title">
      <PageHero
        icon={UserGroupIcon}
        titleId="team-title"
        media={
          <TeamImage
            src={props.pictureUrl}
            name={props.name}
            className="size-20 rounded-2xl text-foreground ring-2 ring-white/40 sm:size-24"
          />
        }
        title={props.name}
        description={
          <p>
            {t('teams.tag')}{t('common.colon')}{' '}
            {props.tag ? <span className="font-mono font-semibold text-white">{props.tag}</span> : t('teams.noTag')}
          </p>
        }
        back={props.back}
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('teams.actions')}>
          <Button variant="outline" className={HERO_ACTION} onClick={props.onRefresh}>
            <Icon icon={RefreshIcon} />
            {t('teams.refreshTeam')}
          </Button>
          {props.canManage ? (
            <>
              <Link to={props.editTo} className={cn(buttonVariants({ variant: 'outline' }), HERO_ACTION)}>
                <Icon icon={Edit02Icon} />
                {t('teams.edit')}
              </Link>
              <ConfirmDeleteDialog
                label={props.deleteLabels.label}
                busyLabel={props.deleteLabels.busy}
                title={props.deleteLabels.title}
                description={props.deleteLabels.description}
                busy={props.deleting}
                onConfirm={props.onDelete}
              />
            </>
          ) : null}
        </div>
      </PageHero>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {props.details.map((detail) => (
          <FactTile key={detail.label} icon={detail.icon ?? InformationCircleIcon} label={detail.label}>
            {detail.value}
          </FactTile>
        ))}
      </dl>
      {props.deleteError ? <StateMessage kind="error">{t(props.deleteError)}</StateMessage> : null}
    </article>
  )
}
