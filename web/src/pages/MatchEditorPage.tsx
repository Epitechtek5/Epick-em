import { Add01Icon, ArrowLeft01Icon, Edit02Icon, LockedIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { MatchStatusBadge } from '@/components/matches/MatchBadges'
import { MatchForm } from '@/components/matches/MatchForm'
import { PageHero } from '@/components/tournaments/ui'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { createMatch, listMatches, updateMatch } from '@/features/matches/api'
import { isConflict, matchErrorDetail, matchErrorKey, matchFieldErrors } from '@/features/matches/errors'
import { matchesPath, matchNumbers } from '@/features/matches/organize'
import type { MatchFieldErrors, MatchValues } from '@/features/matches/types'
import { canEditMatch, changedMatchFields, emptyMatch, matchesWritable, matchValues, toMatchInput } from '@/features/matches/validation'
import { getStepRanking, listSteps } from '@/features/steps/api'
import { isUuid } from '@/features/teams/validation'
import { getTournament } from '@/features/tournaments/api'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useParticipantIdentities } from '@/hooks/use-participant-identities'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

// Création (…/matches/new, au statut `scheduled`) et modification (…/matches/:matchId/edit) d'un
// match, réservées aux administrateurs (AdminRoute ; le serveur reste juge) pendant l'étape.
export default function MatchEditorPage() {
  const { tournamentId = '', stepId = '', matchId } = useParams()
  const editing = matchId !== undefined
  const { t } = useI18n()
  const navigate = useNavigate()
  const { refreshRole } = useAuth()
  const valid = isUuid(tournamentId) && isUuid(stepId) && (!editing || isUuid(matchId))

  const { state, reload } = useAsyncResource(
    async (signal) => {
      if (!valid) throw new ApiError(404, undefined)
      const [tournament, steps, groups, matches] = await Promise.all([
        getTournament(tournamentId, signal),
        listSteps(tournamentId, signal),
        getStepRanking(tournamentId, stepId, signal),
        listMatches(tournamentId, stepId, {}, signal),
      ])
      const step = steps.find((candidate) => candidate.id === stepId)
      const current = editing ? (matches.find((candidate) => candidate.id === matchId) ?? null) : null
      if (!step || (editing && !current)) throw new ApiError(404, undefined)
      return { tournament, step, groups, matches, current }
    },
    [tournamentId, stepId, matchId],
  )
  const data = state.status === 'success' ? state.data : null
  const people = useParticipantIdentities(data?.tournament ?? { id: tournamentId, participant_type: 'solo' }, data !== null)
  const numbers = matchNumbers(data?.matches ?? [])

  const title = data?.current
    ? t('matches.editFor', { number: numbers.get(data.current.id) ?? 0 })
    : editing
      ? t('matches.edit')
      : t('matches.create')
  useDocumentTitle(data ? `${title} · ${data.tournament.name}` : title)

  const [busy, setBusy] = useState(false)
  const [serverErrors, setServerErrors] = useState<MatchFieldErrors>()
  const [formError, setFormError] = useState<{ key: MessageKey; detail?: string } | null>(null)
  const [unchanged, setUnchanged] = useState(false)

  const stepPath = `/tournaments/${tournamentId}/steps/${stepId}`
  const backTo = editing && valid ? `${matchesPath(tournamentId, stepId)}/${matchId}` : stepPath

  async function submit(values: MatchValues) {
    if (!data || busy) return
    setBusy(true)
    setServerErrors(undefined)
    setFormError(null)
    setUnchanged(false)
    try {
      const input = toMatchInput(values)
      if (data.current) {
        const changes = changedMatchFields(data.current, input)
        if (Object.keys(changes).length === 0) {
          setUnchanged(true)
          return
        }
        const saved = await updateMatch(tournamentId, stepId, data.current.id, changes)
        navigate(`${matchesPath(tournamentId, stepId)}/${saved.id}`, {
          replace: true,
          state: { notice: { key: 'matches.updated', params: { number: numbers.get(saved.id) ?? 0 } } },
        })
      } else {
        const created = await createMatch(tournamentId, stepId, input)
        navigate(`${matchesPath(tournamentId, stepId)}/${created.id}`, {
          replace: true,
          state: { notice: { key: 'matches.created' } },
        })
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      const fields = matchFieldErrors(error)
      if (fields) setServerErrors(fields)
      else setFormError({ key: matchErrorKey(error, 'save'), detail: matchErrorDetail(error) })
      // Un 409 signale un état changé ailleurs : relecture pour montrer l'état réel.
      if (isConflict(error)) reload()
    } finally {
      setBusy(false)
    }
  }

  const writable = data ? (data.current ? canEditMatch(data.step, data.current) : matchesWritable(data.step)) : false

  return (
    <div className="grid w-full max-w-5xl gap-6 self-start">
      <PageHero
        icon={editing ? Edit02Icon : Add01Icon}
        title={title}
        description={
          data ? (
            <span>
              <span className="font-semibold text-white">{data.tournament.name}</span>
              <span> · {t('steps.positionTitle', { position: data.step.position })}</span>
              {editing ? null : <span className="block">{t('matches.createIntro')}</span>}
            </span>
          ) : undefined
        }
        back={
          <Link
            to={valid ? backTo : '/tournaments'}
            className="inline-flex items-center gap-1 font-medium text-white/90 underline underline-offset-4 hover:text-white"
          >
            <Icon icon={ArrowLeft01Icon} size={16} />
            {editing && valid ? t('matches.returnToMatch') : valid ? t('steps.returnToStep') : t('tournaments.returnToCatalog')}
          </Link>
        }
      >
        {data?.current ? <MatchStatusBadge status={data.current.status} className="shadow-sm" /> : null}
      </PageHero>

      {!valid ? <StateMessage kind="error">{t('matches.errors.invalidId')}</StateMessage> : null}
      {valid && state.status === 'loading' ? <StateMessage kind="loading">{t('matches.loadingMatch')}</StateMessage> : null}
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

      {data && !writable ? (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-950 ring-1 ring-amber-500/30 ring-inset dark:bg-amber-500/15 dark:text-amber-50">
          <Icon icon={LockedIcon} size={18} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
          <span>
            {t(
              data.step.status === 'pending'
                ? 'matches.lockedPending'
                : data.step.status === 'finished'
                  ? 'matches.lockedFinished'
                  : 'matches.lockedMatch',
            )}{' '}
            <Link to={backTo} className="font-medium underline underline-offset-4">
              {editing ? t('matches.returnToMatch') : t('steps.returnToStep')}
            </Link>
          </span>
        </p>
      ) : null}

      {unchanged ? <StateMessage kind="empty">{t('matches.noChanges')}</StateMessage> : null}

      {data && writable ? (
        <MatchForm
          key={data.current?.updated_at ?? 'new'}
          initial={data.current ? matchValues(data.current) : emptyMatch(data.groups.length === 1 ? data.groups[0].group_id : '')}
          step={data.step}
          groups={data.groups}
          matches={data.matches}
          current={data.current}
          numbers={numbers}
          identity={people.identity}
          submitLabel={data.current ? t('common.save') : t('matches.createSubmit')}
          busy={busy}
          serverErrors={serverErrors}
          formError={formError?.key ?? null}
          formDetail={formError?.detail}
          onSubmit={(values) => void submit(values)}
          onCancel={() => navigate(backTo)}
        />
      ) : null}
    </div>
  )
}
