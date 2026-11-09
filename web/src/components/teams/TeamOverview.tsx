import { Edit02Icon, RefreshIcon } from '@hugeicons/core-free-icons'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { StateMessage } from '@/components/games/StateMessage'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { useI18n, type MessageKey } from '@/i18n/context'
import { TeamImage } from './TeamImage'

interface TeamOverviewProps {
  name: string
  tag: string | null
  pictureUrl: string | null
  // Lignes de description supplémentaires (jeu, propriétaire, tournoi…), déjà traduites.
  details: Array<{ label: string; value: ReactNode }>
  canManage: boolean
  editTo: string
  deleteLabels: { label: string; busy: string; title: string; description: string }
  deleting: boolean
  deleteError: MessageKey | null
  onDelete: () => void
  onRefresh: () => void
}

// En-tête d'une fiche d'équipe (globale ou de tournoi) : photo avec repli, nom, tag, détails,
// et actions réservées au propriétaire (modifier, supprimer après confirmation).
export function TeamOverview(props: TeamOverviewProps) {
  const { t } = useI18n()
  return (
    <article className="flex flex-wrap items-start gap-6" aria-labelledby="team-title">
      <TeamImage src={props.pictureUrl} name={props.name} className="size-32" />
      <div className="grid min-w-0 flex-1 basis-64 content-start gap-4">
        <div className="grid gap-1">
          <h1 id="team-title" className="text-3xl font-semibold tracking-tight break-words">
            {props.name}
          </h1>
          <p className="text-muted-foreground">
            {t('teams.tag')} :{' '}
            {props.tag ? <span className="font-mono">{props.tag}</span> : t('teams.noTag')}
          </p>
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          {props.details.map((detail) => (
            <div key={detail.label} className="contents">
              <dt className="font-medium">{detail.label}</dt>
              <dd className="break-all text-muted-foreground">{detail.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={props.onRefresh}>
            <Icon icon={RefreshIcon} />
            {t('teams.refreshTeam')}
          </Button>
          {props.canManage ? (
            <>
              <Link to={props.editTo} className={buttonVariants({ variant: 'outline' })}>
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
        {props.deleteError ? <StateMessage kind="error">{t(props.deleteError)}</StateMessage> : null}
      </div>
    </article>
  )
}
