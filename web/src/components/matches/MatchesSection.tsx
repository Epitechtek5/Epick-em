import { Add01Icon, FilterIcon, HierarchyIcon, InformationCircleIcon, LockedIcon, RefreshIcon, SwordIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { EmptyState, SectionCard } from '@/components/tournaments/ui'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { listMatches } from '@/features/matches/api'
import { matchErrorKey } from '@/features/matches/errors'
import { matchStatusLabelKey } from '@/features/matches/labels'
import { groupIndexes, matchesPath, matchNumbers } from '@/features/matches/organize'
import { MATCH_STATUSES, type Match, type MatchStatus } from '@/features/matches/types'
import { isElimination, matchesWritable } from '@/features/matches/validation'
import { getStepRanking } from '@/features/steps/api'
import type { Step } from '@/features/steps/types'
import type { Tournament } from '@/features/tournaments/types'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useParticipantIdentities } from '@/hooks/use-participant-identities'
import { useI18n } from '@/i18n/context'
import { MatchBoard } from './MatchBoard'
import type { MatchDisplay } from './MatchCard'

// Matchs d'une étape, sur la page de l'étape : filtres du serveur (groupe, statut), vue propre au
// format, création réservée aux administrateurs pendant l'étape. `version` change après un
// lancement ou une clôture de l'étape pour forcer la relecture.
export function MatchesSection({
  tournament,
  step,
  version,
  canManage,
}: {
  tournament: Tournament
  step: Step
  version: number
  canManage: boolean
}) {
  const { t } = useI18n()
  const [groupId, setGroupId] = useState('')
  const [status, setStatus] = useState<MatchStatus | ''>('')
  const filtered = groupId !== '' || status !== ''

  // Liste complète (numéros, liens, places libres) et groupes de l'étape.
  const base = useAsyncResource(
    async (signal) => {
      const [matches, groups] = await Promise.all([
        listMatches(tournament.id, step.id, {}, signal),
        getStepRanking(tournament.id, step.id, signal),
      ])
      return { matches, groups }
    },
    [tournament.id, step.id, step.status, version],
  )
  // Liste filtrée par le serveur (group_id, status) ; la liste complète sert sans filtre.
  const subset = useAsyncResource<Match[] | null>(
    (signal) =>
      filtered
        ? listMatches(tournament.id, step.id, { group_id: groupId || undefined, status: status || undefined }, signal)
        : Promise.resolve(null),
    [tournament.id, step.id, groupId, status, version],
  )
  const data = base.state.status === 'success' ? base.state.data : null
  const people = useParticipantIdentities(tournament, Boolean(data && data.matches.length > 0))

  const refresh = () => {
    base.reload()
    subset.reload()
    people.reload()
  }

  const root = matchesPath(tournament.id, step.id)
  const display: MatchDisplay | null = data
    ? {
        numbers: matchNumbers(data.matches),
        identity: people.identity,
        groupIndexes: groupIndexes(data.groups),
        matchPath: (match) => `${root}/${match.id}`,
      }
    : null
  const shown = filtered ? (subset.state.status === 'success' ? subset.state.data : null) : (data?.matches ?? null)
  const writable = matchesWritable(step)

  return (
    <SectionCard
      id="step-matches-title"
      icon={SwordIcon}
      title={t('matches.title')}
      subtitle={t('matches.hint')}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={refresh}>
            <Icon icon={RefreshIcon} />
            {t('matches.refresh')}
          </Button>
          {isElimination(step) ? (
            <Link to={`/tournaments/${tournament.id}/steps/${step.id}/bracket`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <Icon icon={HierarchyIcon} />
              {t('matches.viewBracket')}
            </Link>
          ) : null}
          {canManage && writable ? (
            <Link to={`${root}/new`} className={buttonVariants({ size: 'sm' })}>
              <Icon icon={Add01Icon} />
              {t('matches.create')}
            </Link>
          ) : null}
        </>
      }
    >
      <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <Icon icon={InformationCircleIcon} size={18} className="mt-0.5 shrink-0" />
        {t('matches.noGeneration')}
      </p>
      {!writable ? (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-500/30 ring-inset dark:bg-amber-500/15 dark:text-amber-50">
          <Icon icon={LockedIcon} size={18} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
          {t(step.status === 'pending' ? 'matches.lockedPending' : 'matches.lockedFinished')}
        </p>
      ) : !canManage ? (
        <p className="text-sm text-muted-foreground">{t('matches.readOnly')}</p>
      ) : null}

      {base.state.status === 'loading' ? <StateMessage kind="loading">{t('matches.loading')}</StateMessage> : null}
      {base.state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={base.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(matchErrorKey(base.state.error))}
        </StateMessage>
      ) : null}
      {people.state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={people.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t('matches.participantsUnavailable')}
        </StateMessage>
      ) : null}

      {data && data.matches.length === 0 ? <EmptyState icon={SwordIcon}>{t('matches.empty')}</EmptyState> : null}

      {data && display && data.matches.length > 0 ? (
        <>
          <fieldset className="flex flex-wrap items-end gap-3 rounded-xl bg-muted/40 p-3">
            <legend className="sr-only">{t('matches.filters')}</legend>
            <Icon icon={FilterIcon} size={18} className="mb-2 text-muted-foreground" />
            {data.groups.length > 1 ? (
              <div className="grid gap-1">
                <Label htmlFor="match-filter-group">{t('matches.groupLabel')}</Label>
                <NativeSelect id="match-filter-group" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                  <option value="">{t('matches.allGroups')}</option>
                  {data.groups.map((group) => (
                    <option key={group.group_id} value={group.group_id}>
                      {t('matches.groupNumber', { index: group.index })}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
            <div className="grid gap-1">
              <Label htmlFor="match-filter-status">{t('matches.statusLabel')}</Label>
              <NativeSelect id="match-filter-status" value={status} onChange={(event) => setStatus(event.target.value as MatchStatus | '')}>
                <option value="">{t('matches.allStatuses')}</option>
                {MATCH_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(matchStatusLabelKey(value))}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {filtered ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setGroupId('')
                  setStatus('')
                }}
              >
                {t('matches.clearFilters')}
              </Button>
            ) : null}
          </fieldset>

          {filtered && subset.state.status === 'loading' ? <StateMessage kind="loading">{t('matches.loading')}</StateMessage> : null}
          {filtered && subset.state.status === 'error' ? (
            <StateMessage
              kind="error"
              action={
                <Button variant="outline" size="sm" onClick={subset.reload}>
                  {t('common.retry')}
                </Button>
              }
            >
              {t(matchErrorKey(subset.state.error))}
            </StateMessage>
          ) : null}
          {shown ? (
            <>
              <p role="status" className="text-sm text-muted-foreground">
                {t('matches.count', { count: shown.length })}
              </p>
              {shown.length === 0 ? (
                <EmptyState icon={FilterIcon}>{t('matches.emptyFiltered')}</EmptyState>
              ) : (
                <MatchBoard step={step} matches={shown} all={data.matches} groups={data.groups} display={display} />
              )}
            </>
          ) : null}
        </>
      ) : null}
    </SectionCard>
  )
}
