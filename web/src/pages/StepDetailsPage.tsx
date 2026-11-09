import {
  ArrowLeft01Icon,
  Edit02Icon,
  GridViewIcon,
  LockedIcon,
  RankingIcon,
  RefreshIcon,
  Route01Icon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { MatchesSection } from '@/components/matches/MatchesSection'
import { StateMessage } from '@/components/games/StateMessage'
import { StepStatusBadge } from '@/components/steps/StepBadges'
import { StepGroups } from '@/components/steps/StepGroups'
import { StepLifecycle } from '@/components/steps/StepLifecycle'
import { TournamentStatusBadge } from '@/components/tournaments/TournamentStatusBadge'
import { Chip, FactTile, PageHero } from '@/components/tournaments/ui'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { readNotice } from '@/features/games/notice'
import { deleteStep, listSteps } from '@/features/steps/api'
import { stepErrorKey } from '@/features/steps/errors'
import { formatDescKey, formatLabelKey, matchTypeDescKey, matchTypeLabelKey } from '@/features/steps/labels'
import type { Step } from '@/features/steps/types'
import { capacityOf, qualifiedOf, stepsEditable } from '@/features/steps/validation'
import { isUuid } from '@/features/teams/validation'
import { getTournament } from '@/features/tournaments/api'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

// Page d'une étape (/tournaments/:tournamentId/steps/:stepId) : réglages, déroulement (lancement
// et clôture pour les administrateurs), groupes et classements renvoyés par le serveur.
export default function StepDetailsPage() {
  const { tournamentId = '', stepId = '' } = useParams()
  const { t } = useI18n()
  const { isAdmin, refreshRole } = useAuth()
  const navigate = useNavigate()
  const notice = readNotice(useLocation().state)
  const valid = isUuid(tournamentId) && isUuid(stepId)

  const { state, reload } = useAsyncResource(
    async (signal) => {
      if (!valid) throw new ApiError(404, undefined)
      const [tournament, steps] = await Promise.all([getTournament(tournamentId, signal), listSteps(tournamentId, signal)])
      if (!steps.some((step) => step.id === stepId)) throw new ApiError(404, undefined)
      return { tournament, steps }
    },
    [tournamentId, stepId],
  )
  // Étapes à jour après un lancement ou une clôture, sans recharger la page ; oubliées dès que
  // le serveur renvoie une nouvelle version (actualisation).
  const loaded = state.status === 'success' ? state.data : null
  const [local, setLocal] = useState<{ base: typeof loaded; steps: Step[] } | null>(null)
  const steps = local && local.base === loaded ? local.steps : (loaded?.steps ?? [])
  const tournament = loaded?.tournament ?? null
  const step = steps.find((candidate) => candidate.id === stepId) ?? null
  const [version, setVersion] = useState(0)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<MessageKey | null>(null)

  const title = step ? t('steps.positionTitle', { position: step.position }) : t('steps.details')
  useDocumentTitle(tournament ? `${title} · ${tournament.name}` : title)

  function applyChanges(updated: Step[]) {
    if (!loaded) return
    const byId = new Map(updated.map((value) => [value.id, value]))
    setLocal({ base: loaded, steps: steps.map((value) => byId.get(value.id) ?? value) })
    setVersion((v) => v + 1)
  }

  async function remove() {
    if (!step) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteStep(tournamentId, step.id)
      navigate(`/tournaments/${tournamentId}`, {
        replace: true,
        state: { notice: { key: 'steps.deleted', params: { position: step.position } } },
      })
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      setDeleteError(stepErrorKey(error))
      setDeleting(false)
    }
  }

  const editable = tournament ? stepsEditable(tournament.status) : false

  return (
    <div className="grid w-full max-w-6xl gap-8 self-start">
      <PageHero
        icon={Route01Icon}
        title={step ? `${title} · ${t(formatLabelKey(step.format))}` : title}
        description={
          tournament ? (
            <Link to={`/tournaments/${tournament.id}`} className="font-semibold text-white underline underline-offset-4">
              {tournament.name}
            </Link>
          ) : undefined
        }
        back={
          <Link
            to={valid ? `/tournaments/${tournamentId}` : '/tournaments'}
            className="inline-flex items-center gap-1 font-medium text-white/90 underline underline-offset-4 hover:text-white"
          >
            <Icon icon={ArrowLeft01Icon} size={16} />
            {valid ? t('steps.returnToTournament') : t('tournaments.returnToCatalog')}
          </Link>
        }
      >
        {step && tournament ? (
          <div className="flex flex-wrap gap-2">
            <StepStatusBadge status={step.status} className="shadow-sm" />
            <TournamentStatusBadge status={tournament.status} className="shadow-sm" />
          </div>
        ) : null}
      </PageHero>

      {notice ? <StateMessage kind="success">{t(notice.key, notice.params)}</StateMessage> : null}

      {!valid ? <StateMessage kind="error">{t('steps.errors.invalidId')}</StateMessage> : null}
      {valid && state.status === 'loading' ? <StateMessage kind="loading">{t('steps.loadingStep')}</StateMessage> : null}
      {valid && state.status === 'error' ? (
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

      {tournament && step ? (
        <>
          <article aria-labelledby="step-config-title" className="grid gap-5">
            <h2 id="step-config-title" className="sr-only">
              {t('steps.details')}
            </h2>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FactTile icon={Route01Icon} label={t('steps.formatLabel')}>
                <span className="block">{t(formatLabelKey(step.format))}</span>
                <span className="block font-normal text-muted-foreground">{t(formatDescKey(step.format))}</span>
              </FactTile>
              <FactTile icon={UserMultipleIcon} label={t('steps.matchTypeLabel')}>
                <span className="block">{t(matchTypeLabelKey(step.match_type))}</span>
                <span className="block font-normal text-muted-foreground">{t(matchTypeDescKey(step.match_type))}</span>
              </FactTile>
              <FactTile icon={GridViewIcon} label={t('steps.sections.groups')}>
                <span className="block">
                  {t('steps.summary', { groups: step.group_count, size: step.group_size, advance: step.advance_per_group })}
                </span>
                <span className="block font-normal text-muted-foreground">
                  {t('steps.matchesPerGroup')} : {step.matches_per_group}
                </span>
              </FactTile>
              <FactTile icon={RankingIcon} label={t('steps.chain.title')}>
                {t('steps.flow', { capacity: capacityOf(step), qualified: qualifiedOf(step) })}
              </FactTile>
            </dl>

            <div className="grid gap-2 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('steps.tiebreak')}</h3>
              {step.tiebreak.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('steps.tiebreakEmpty')}</p>
              ) : (
                <ol aria-label={t('steps.tiebreakList')} className="flex flex-wrap gap-2">
                  {step.tiebreak.map((key, index) => (
                    <li key={key}>
                      <Chip>
                        <span className="font-mono font-bold" aria-hidden="true">
                          {index + 1}.
                        </span>
                        <span className="sr-only">{t('steps.tiebreakPriority', { n: index + 1 })} : </span>
                        <code className="font-mono">{key}</code>
                      </Chip>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={reload}>
                <Icon icon={RefreshIcon} />
                {t('steps.refresh')}
              </Button>
              {isAdmin && editable ? (
                <>
                  <Link to={`/tournaments/${tournament.id}/steps/${step.id}/edit`} className={buttonVariants({ variant: 'outline' })}>
                    <Icon icon={Edit02Icon} />
                    {t('steps.edit')}
                  </Link>
                  <ConfirmDeleteDialog
                    label={t('steps.delete')}
                    busyLabel={t('steps.deleting')}
                    title={t('steps.confirmDeleteTitle')}
                    description={t('steps.confirmDelete', { position: step.position })}
                    busy={deleting}
                    onConfirm={() => void remove()}
                  />
                </>
              ) : null}
            </div>
            {isAdmin && !editable ? (
              <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-500/30 ring-inset dark:bg-amber-500/15 dark:text-amber-50">
                <Icon icon={LockedIcon} size={18} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
                {t('steps.locked')}
              </p>
            ) : null}
            {deleteError ? <StateMessage kind="error">{t(deleteError)}</StateMessage> : null}
          </article>

          <StepLifecycle key={step.id} tournament={tournament} step={step} steps={steps} canManage={isAdmin} onChanged={applyChanges} />
          <StepGroups tournament={tournament} step={step} version={version} />
          <MatchesSection tournament={tournament} step={step} version={version} canManage={isAdmin} />
        </>
      ) : null}
    </div>
  )
}
