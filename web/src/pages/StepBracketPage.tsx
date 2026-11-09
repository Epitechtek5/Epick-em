import { ArrowLeft01Icon, HierarchyIcon, InformationCircleIcon, ListViewIcon, RefreshIcon, SwordIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { MatchBoard } from '@/components/matches/MatchBoard'
import { MatchBracket } from '@/components/matches/MatchBracket'
import type { MatchDisplay } from '@/components/matches/MatchCard'
import { StepStatusBadge } from '@/components/steps/StepBadges'
import { EmptyState, PageHero, SectionCard } from '@/components/tournaments/ui'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { listMatches } from '@/features/matches/api'
import { matchErrorKey } from '@/features/matches/errors'
import { groupIndexes, matchesPath, matchNumbers } from '@/features/matches/organize'
import { isElimination } from '@/features/matches/validation'
import { getStepRanking, listSteps } from '@/features/steps/api'
import { formatLabelKey } from '@/features/steps/labels'
import { isUuid } from '@/features/teams/validation'
import { getTournament } from '@/features/tournaments/api'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useParticipantIdentities } from '@/hooks/use-participant-identities'
import { useI18n } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { cn } from '@/lib/utils'

// Tableau d'une étape (/tournaments/:tournamentId/steps/:stepId/bracket) : graphique en
// élimination, avec sa liste par tour en alternative ; vue propre au format sinon.
export default function StepBracketPage() {
  const { tournamentId = '', stepId = '' } = useParams()
  const { t } = useI18n()
  const valid = isUuid(tournamentId) && isUuid(stepId)
  const [view, setView] = useState<'graph' | 'list'>('graph')

  const { state, reload } = useAsyncResource(
    async (signal) => {
      if (!valid) throw new ApiError(404, undefined)
      const [tournament, steps, matches, groups] = await Promise.all([
        getTournament(tournamentId, signal),
        listSteps(tournamentId, signal),
        listMatches(tournamentId, stepId, {}, signal),
        getStepRanking(tournamentId, stepId, signal),
      ])
      const step = steps.find((candidate) => candidate.id === stepId)
      if (!step) throw new ApiError(404, undefined)
      return { tournament, step, matches, groups }
    },
    [tournamentId, stepId],
  )
  const data = state.status === 'success' ? state.data : null
  const people = useParticipantIdentities(
    data?.tournament ?? { id: tournamentId, participant_type: 'solo' },
    Boolean(data && data.matches.length > 0),
  )

  const title = data ? t('matches.bracketTitle', { position: data.step.position }) : t('matches.bracketPage')
  useDocumentTitle(data ? `${title} · ${data.tournament.name}` : title)

  const stepPath = `/tournaments/${tournamentId}/steps/${stepId}`
  const display: MatchDisplay | null = data
    ? {
        numbers: matchNumbers(data.matches),
        identity: people.identity,
        groupIndexes: groupIndexes(data.groups),
        matchPath: (match) => `${matchesPath(tournamentId, stepId)}/${match.id}`,
      }
    : null
  const elimination = data ? isElimination(data.step) : false

  return (
    <div className="grid w-full max-w-7xl gap-8 self-start">
      <PageHero
        icon={HierarchyIcon}
        title={data ? `${title} · ${t(formatLabelKey(data.step.format))}` : title}
        description={
          data ? (
            <Link to={`/tournaments/${data.tournament.id}`} className="font-semibold text-white underline underline-offset-4">
              {data.tournament.name}
            </Link>
          ) : undefined
        }
        back={
          <Link
            to={valid ? stepPath : '/tournaments'}
            className="inline-flex items-center gap-1 font-medium text-white/90 underline underline-offset-4 hover:text-white"
          >
            <Icon icon={ArrowLeft01Icon} size={16} />
            {valid ? t('steps.returnToStep') : t('tournaments.returnToCatalog')}
          </Link>
        }
      >
        {data ? <StepStatusBadge status={data.step.status} className="shadow-sm" /> : null}
      </PageHero>

      {!valid ? <StateMessage kind="error">{t('steps.errors.invalidId')}</StateMessage> : null}
      {valid && state.status === 'loading' ? <StateMessage kind="loading">{t('matches.loading')}</StateMessage> : null}
      {valid && state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(matchErrorKey(state.error))}
        </StateMessage>
      ) : null}

      {data && display ? (
        <SectionCard
          id="bracket-title"
          icon={elimination ? HierarchyIcon : SwordIcon}
          title={elimination ? t('matches.bracketHeading') : t('matches.title')}
          subtitle={elimination ? t('matches.bracketHint') : t('matches.notBracket')}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                reload()
                people.reload()
              }}
            >
              <Icon icon={RefreshIcon} />
              {t('matches.refresh')}
            </Button>
          }
        >
          <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            <Icon icon={InformationCircleIcon} size={18} className="mt-0.5 shrink-0" />
            {t('matches.noGeneration')}
          </p>
          {data.matches.length === 0 ? (
            <EmptyState icon={SwordIcon}>{t('matches.empty')}</EmptyState>
          ) : elimination ? (
            <>
              <div role="group" aria-label={t('matches.viewLabel')} className="inline-flex w-fit rounded-lg bg-muted p-1">
                {(
                  [
                    ['graph', HierarchyIcon, 'matches.viewGraph'],
                    ['list', ListViewIcon, 'matches.viewList'],
                  ] as const
                ).map(([value, icon, label]) => (
                  <Button
                    key={value}
                    variant="ghost"
                    size="sm"
                    aria-pressed={view === value}
                    className={cn(view === value && 'bg-background shadow-sm')}
                    onClick={() => setView(value)}
                  >
                    <Icon icon={icon} />
                    {t(label)}
                  </Button>
                ))}
              </div>
              {view === 'graph' ? (
                <MatchBracket step={data.step} matches={data.matches} display={display} />
              ) : (
                <MatchBoard step={data.step} matches={data.matches} groups={data.groups} display={display} />
              )}
            </>
          ) : (
            <MatchBoard step={data.step} matches={data.matches} groups={data.groups} display={display} />
          )}
        </SectionCard>
      ) : null}
    </div>
  )
}
