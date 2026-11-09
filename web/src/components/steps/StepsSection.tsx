import {
  HierarchyIcon,
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Edit02Icon,
  InformationCircleIcon,
  LockedIcon,
  RefreshIcon,
  Route01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { Link } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { Chip, EmptyState, SectionCard } from '@/components/tournaments/ui'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { listSteps } from '@/features/steps/api'
import { stepErrorKey } from '@/features/steps/errors'
import { formatLabelKey, matchTypeLabelKey } from '@/features/steps/labels'
import type { Step } from '@/features/steps/types'
import { isElimination } from '@/features/matches/validation'
import { capacityOf, qualifiedOf, stepsEditable } from '@/features/steps/validation'
import type { Tournament } from '@/features/tournaments/types'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { ChainCheck } from './ChainCheck'
import { StepStatusBadge } from './StepBadges'

// Pastille de position, sur le modèle de la frise du cycle de vie du tournoi.
function PositionBubble({ step }: { step: Step }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative z-10 grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold ring-4 ring-card',
        step.status === 'finished' && 'bg-primary text-primary-foreground',
        step.status === 'ongoing' && 'bg-primary text-primary-foreground shadow-lg shadow-primary/30 outline-2 outline-offset-2 outline-primary',
        step.status === 'pending' && 'bg-muted text-muted-foreground',
      )}
    >
      {step.status === 'finished' ? <Icon icon={Tick02Icon} size={18} /> : step.position}
    </span>
  )
}

// Étapes du tournoi (GET /tournaments/{id}/steps), dans leur ordre : format, type de match,
// statut, groupes et progression. Ajout et modification pour les administrateurs tant que le
// tournoi n'a pas démarré ; le détail, les groupes et le lancement sont sur la page de l'étape.
export function StepsSection({ tournament, canManage }: { tournament: Tournament; canManage: boolean }) {
  const { t } = useI18n()
  const { state, reload } = useAsyncResource((signal) => listSteps(tournament.id, signal), [tournament.id, tournament.status])
  const editable = stepsEditable(tournament.status)
  const steps = state.status === 'success' ? state.data : []
  const base = `/tournaments/${tournament.id}/steps`

  return (
    <SectionCard
      id="steps-title"
      icon={Route01Icon}
      title={t('steps.title')}
      subtitle={t('steps.sectionHint')}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={reload}>
            <Icon icon={RefreshIcon} />
            {t('steps.refresh')}
          </Button>
          {canManage && editable ? (
            <Link to={`${base}/new`} className={buttonVariants({ size: 'sm' })}>
              <Icon icon={Add01Icon} />
              {t('steps.add')}
            </Link>
          ) : null}
        </>
      }
    >
      {canManage && !editable ? (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-500/30 ring-inset dark:bg-amber-500/15 dark:text-amber-50">
          <Icon icon={LockedIcon} size={18} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
          {t('steps.locked')}
        </p>
      ) : null}
      {!canManage ? <p className="text-sm text-muted-foreground">{t('steps.readOnly')}</p> : null}

      {state.status === 'loading' ? <StateMessage kind="loading">{t('steps.loading')}</StateMessage> : null}
      {state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(stepErrorKey(state.error))}
        </StateMessage>
      ) : null}
      {state.status === 'success' && steps.length === 0 ? (
        <EmptyState icon={Route01Icon}>{t('steps.empty')}</EmptyState>
      ) : null}

      {steps.length > 0 ? (
        <ol aria-label={t('steps.list')} className="grid gap-0">
          {steps.map((step, index) => (
            <li key={step.id} className="grid gap-0">
              <article
                aria-labelledby={`step-${step.id}-title`}
                className="flex flex-wrap items-center gap-4 rounded-xl bg-background/60 p-4 ring-1 ring-foreground/10 dark:bg-input/20"
              >
                <PositionBubble step={step} />
                <div className="grid min-w-0 flex-1 gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 id={`step-${step.id}-title`} className="font-semibold">
                      {t('steps.positionTitle', { position: step.position })} · {t(formatLabelKey(step.format))}
                    </h3>
                    <StepStatusBadge status={step.status} />
                    <Chip>{t(matchTypeLabelKey(step.match_type))}</Chip>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t('steps.summary', { groups: step.group_count, size: step.group_size, advance: step.advance_per_group })}
                  </p>
                  <p className="text-sm font-medium">
                    {t('steps.flow', { capacity: capacityOf(step), qualified: qualifiedOf(step) })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canManage && editable ? (
                    <Link
                      to={`${base}/${step.id}/edit`}
                      aria-label={t('steps.editFor', { position: step.position })}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      <Icon icon={Edit02Icon} />
                      {t('steps.edit')}
                    </Link>
                  ) : null}
                  {isElimination(step) ? (
                    <Link
                      to={`${base}/${step.id}/bracket`}
                      aria-label={t('matches.bracketFor', { position: step.position })}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      <Icon icon={HierarchyIcon} />
                      {t('matches.bracketShort')}
                    </Link>
                  ) : null}
                  <Link
                    to={`${base}/${step.id}`}
                    aria-label={t('steps.viewFor', { position: step.position })}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    {t('steps.view')}
                    <Icon icon={ArrowRight01Icon} />
                  </Link>
                </div>
              </article>
              {index < steps.length - 1 ? (
                <span aria-hidden="true" className="flex items-center gap-2 py-1.5 pl-7 text-xs font-medium text-muted-foreground">
                  <Icon icon={ArrowDown01Icon} size={14} />
                  {qualifiedOf(step)}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {editable ? <ChainCheck tournament={tournament} steps={steps} /> : null}

      <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <Icon icon={InformationCircleIcon} size={18} className="mt-0.5 shrink-0" />
        <span>
          {t('steps.chain.hint')} {t('steps.matches.limits')}
        </span>
      </p>
    </SectionCard>
  )
}
