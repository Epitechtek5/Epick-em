import { MagicWand01Icon, NextIcon, RefreshIcon, ViewIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { StateMessage } from '@/components/games/StateMessage'
import { SectionCard } from '@/components/tournaments/ui'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { listMatches } from '@/features/matches/api'
import { bracketLabelKey } from '@/features/matches/labels'
import { compareRounds } from '@/features/matches/organize'
import { BRACKETS } from '@/features/matches/types'
import { generateMatches, generateNextRound, getStepRanking, previewGeneration } from '@/features/steps/api'
import { startDetail, stepErrorKey } from '@/features/steps/errors'
import { nextRoundReady } from '@/features/steps/validation'
import type { GenerationPreview, PlannedMatch, Step } from '@/features/steps/types'
import { formatPoints } from '@/features/tournaments/format'
import type { Tournament } from '@/features/tournaments/types'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useParticipantIdentities } from '@/hooks/use-participant-identities'
import { useI18n, type MessageKey, type Params } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'
import { cn } from '@/lib/utils'

interface Feedback {
  kind: 'success' | 'error'
  key: MessageKey
  params?: Params
  detail?: string
}

// Génération des matchs d'une étape lancée, pour les organisateurs : aperçu des appariements,
// têtes de série, byes et liens de progression calculés par le serveur, puis confirmation
// (refusée si le plan a changé depuis l'aperçu). En suisse, les rondes suivantes se génèrent
// une fois la ronde en cours terminée. Aucun appariement n'est calculé ici.
export function StepGeneration({
  tournament,
  step,
  version,
  onGenerated,
}: {
  tournament: Tournament
  step: Step
  version: number
  onGenerated: () => void
}) {
  const { t, lang } = useI18n()
  const { refreshRole } = useAuth()
  const [preview, setPreview] = useState<GenerationPreview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'generate' | 'round' | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [pairingFailed, setPairingFailed] = useState(false)

  const state = useAsyncResource(
    async (signal) => {
      const [matches, groups] = await Promise.all([
        listMatches(tournament.id, step.id, {}, signal),
        getStepRanking(tournament.id, step.id, signal),
      ])
      return { matches, groups }
    },
    [tournament.id, step.id, version],
  )
  const data = state.state.status === 'success' ? state.state.data : null
  const people = useParticipantIdentities(tournament, preview !== null)
  const seeds = new Map((data?.groups ?? []).flatMap((group) => group.participants.map((p) => [p.participant_id, p.seed ?? null] as const)))
  const groupIndex = new Map((data?.groups ?? []).map((group) => [group.group_id, group.index]))

  function fail(error: unknown, action: 'generate' | 'round') {
    if (error instanceof ApiError && error.status === 403) void refreshRole()
    setFeedback({ kind: 'error', key: stepErrorKey(error, action), detail: startDetail(error) })
  }

  async function loadPreview() {
    setBusy('preview')
    setFeedback(null)
    try {
      setPreview(await previewGeneration(tournament.id, step.id))
    } catch (error) {
      setPreview(null)
      fail(error, 'generate')
    } finally {
      setBusy(null)
    }
  }

  async function generate() {
    if (!preview) return
    setBusy('generate')
    setFeedback(null)
    try {
      const created = await generateMatches(tournament.id, step.id, preview.revision)
      setPreview(null)
      setFeedback({ kind: 'success', key: 'steps.generation.generated', params: { count: created.matches.length } })
      state.reload()
      onGenerated()
    } catch (error) {
      fail(error, 'generate')
      // Plan périmé (participants, réglages ou matchs créés entre-temps) : nouvel aperçu.
      if (error instanceof ApiError && error.status === 409) {
        try {
          setPreview(await previewGeneration(tournament.id, step.id))
        } catch {
          setPreview(null)
        }
      }
    } finally {
      setBusy(null)
    }
  }

  async function nextRound(allowRematches: boolean) {
    setBusy('round')
    setFeedback(null)
    try {
      const created = await generateNextRound(tournament.id, step.id, allowRematches)
      setPairingFailed(false)
      setFeedback({ kind: 'success', key: 'steps.generation.roundGenerated', params: { count: created.matches.length } })
      state.reload()
      onGenerated()
    } catch (error) {
      const pairing = error instanceof ApiError && error.status === 400 && stepErrorKey(error, 'round') === 'steps.generation.errors.pairing'
      setPairingFailed(pairing)
      fail(error, 'round')
    } finally {
      setBusy(null)
    }
  }

  const matches = data?.matches ?? []
  const ready = nextRoundReady(step, matches)

  return (
    <SectionCard
      id="step-generation-title"
      icon={MagicWand01Icon}
      title={t('steps.generation.title')}
      subtitle={t('steps.generation.hint')}
      actions={
        <Button variant="outline" size="sm" onClick={state.reload}>
          <Icon icon={RefreshIcon} />
          {t('steps.generation.refresh')}
        </Button>
      }
    >
      {state.state.status === 'loading' ? <StateMessage kind="loading">{t('matches.loading')}</StateMessage> : null}
      {state.state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={state.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(stepErrorKey(state.state.error))}
        </StateMessage>
      ) : null}

      {feedback ? (
        <StateMessage kind={feedback.kind}>
          {t(feedback.key, feedback.params)}
          {feedback.detail ? <span className="mt-1 block">{feedback.detail}</span> : null}
        </StateMessage>
      ) : null}

      {data && matches.length === 0 ? (
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">{t('steps.generation.empty')}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant={preview ? 'outline' : 'default'} disabled={busy !== null} onClick={() => void loadPreview()}>
              <Icon icon={ViewIcon} />
              {busy === 'preview' ? t('steps.generation.previewing') : t(preview ? 'steps.generation.refreshPreview' : 'steps.generation.preview')}
            </Button>
            {preview ? (
              <ConfirmDialog
                icon={MagicWand01Icon}
                variant="default"
                label={t('steps.generation.confirm')}
                busyLabel={t('steps.generation.generating')}
                title={t('steps.generation.confirmTitle', { position: step.position })}
                description={t('steps.generation.confirmText', { count: preview.matches.length })}
                busy={busy === 'generate'}
                disabled={busy !== null || preview.matches.length === 0}
                onConfirm={() => void generate()}
              />
            ) : null}
          </div>
          {preview ? (
            <PreviewList
              preview={preview}
              step={step}
              name={(id) => people.identity(id).name}
              seed={(id) => seeds.get(id) ?? null}
              groupIndex={(id) => groupIndex.get(id) ?? null}
              points={(value) => formatPoints(lang, value)}
            />
          ) : null}
        </div>
      ) : null}

      {data && matches.length > 0 ? (
        step.format === 'swiss' ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              {t(ready ? 'steps.generation.roundReady' : 'steps.generation.roundPending', {
                played: Math.max(0, ...matches.map((match) => match.round ?? 0)),
                total: step.matches_per_group,
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy !== null || !ready} onClick={() => void nextRound(false)}>
                <Icon icon={NextIcon} />
                {busy === 'round' ? t('steps.generation.generating') : t('steps.generation.nextRound')}
              </Button>
              {pairingFailed ? (
                <ConfirmDialog
                  label={t('steps.generation.allowRematches')}
                  title={t('steps.generation.allowRematchesTitle')}
                  description={t('steps.generation.allowRematchesText')}
                  busy={busy === 'round'}
                  disabled={busy !== null}
                  onConfirm={() => void nextRound(true)}
                />
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('steps.generation.done', { count: matches.length })}</p>
        )
      ) : null}
    </SectionCard>
  )
}

const regionOrder = (bracket: PlannedMatch['bracket']) => (bracket === null ? BRACKETS.length : BRACKETS.indexOf(bracket))

// Aperçu des matchs prévus, par groupe, tableau et ronde : participants avec leur tête de série,
// byes et liens du vainqueur et du perdant vers les matchs suivants.
function PreviewList({
  preview,
  step,
  name,
  seed,
  groupIndex,
  points,
}: {
  preview: GenerationPreview
  step: Step
  name: (participantId: string) => string
  seed: (participantId: string) => number | null
  groupIndex: (groupId: string) => number | null
  points: (value: number) => string
}) {
  const { t } = useI18n()
  const planned = preview.matches.map((match, index) => ({ match, index }))
  const label = (match: PlannedMatch) => t('steps.generation.plannedMatch', { round: match.round, number: match.number })
  const target = (link: [number, number] | null) => {
    const next = link ? preview.matches[link[0]] : undefined
    return next && link
      ? t('steps.generation.slot', {
          match: `${next.bracket ? `${t(bracketLabelKey(next.bracket))} · ` : ''}${label(next)}`,
          slot: link[1],
        })
      : null
  }
  const byes = planned.filter(({ match }) => match.bye_points !== null).length

  const groups = [...new Set(planned.map(({ match }) => match.group_id))].sort(
    (a, b) => (groupIndex(a) ?? Number.MAX_SAFE_INTEGER) - (groupIndex(b) ?? Number.MAX_SAFE_INTEGER),
  )

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        {t('steps.generation.summary', { count: preview.matches.length, byes })} {t('steps.generation.previewHint')}
      </p>
      {preview.matches.length === 0 ? <StateMessage kind="empty">{t('steps.generation.nothing')}</StateMessage> : null}
      {groups.map((groupId) => {
        const inGroup = planned.filter(({ match }) => match.group_id === groupId)
        const regions = [...new Set(inGroup.map(({ match }) => match.bracket))].sort((a, b) => regionOrder(a) - regionOrder(b))
        const index = groupIndex(groupId)
        const headingId = `preview-group-${groupId}`
        return (
          <section key={groupId} aria-labelledby={headingId} className="grid gap-3">
            {groups.length > 1 || step.format === 'pool' ? (
              <h3 id={headingId} className="font-semibold">
                {index === null ? t('matches.unknownGroup') : t('matches.groupNumber', { index })}
              </h3>
            ) : (
              <h3 id={headingId} className="sr-only">
                {t('steps.generation.title')}
              </h3>
            )}
            {regions.map((region) => {
              const inRegion = inGroup.filter(({ match }) => match.bracket === region)
              const rounds = [...new Set(inRegion.map(({ match }) => match.round))].sort(compareRounds)
              return (
                <div key={region ?? 'none'} className="grid gap-2">
                  {region ? <h4 className="text-sm font-semibold">{t(bracketLabelKey(region))}</h4> : null}
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {rounds.map((round) => (
                      <div key={round} className="grid w-60 shrink-0 content-start gap-2">
                        <p aria-hidden="true" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                          {t('matches.roundNumber', { round })}
                        </p>
                        <ol aria-label={t('matches.roundNumber', { round })} className="grid gap-2">
                        {inRegion
                          .filter(({ match }) => match.round === round)
                          .sort((a, b) => a.match.number - b.match.number)
                          .map(({ match, index: position }) => {
                            const bye = match.bye_points !== null
                            const reset = match.bracket === 'grand_final' && match.round > 1
                            const winner = target(match.next)
                            const loser = target(match.loser_next)
                            const seats = [...match.participants].sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0))
                            const free = Math.max(0, (bye ? 1 : step.match_type === 'duel' ? 2 : seats.length) - seats.length)
                            return (
                              <li
                                key={position}
                                className={cn(
                                  'grid gap-1 rounded-xl bg-background/60 p-3 text-sm ring-1 ring-foreground/10 dark:bg-input/20',
                                  bye && 'ring-sky-500/40',
                                )}
                              >
                                <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                                  {label(match)}
                                  {match.best_of > 1 ? <span className="font-mono text-xs text-muted-foreground">BO{match.best_of}</span> : null}
                                  {reset ? (
                                    <span className="rounded bg-amber-100 px-1.5 text-[0.65rem] text-amber-900 dark:bg-amber-500/20 dark:text-amber-100">
                                      {t('matches.reset')}
                                    </span>
                                  ) : null}
                                </span>
                                <ul className="grid gap-0.5">
                                  {seats.map(([id]) => {
                                    const value = seed(id)
                                    return (
                                      <li key={id} className="flex min-w-0 items-center gap-2">
                                        <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">
                                          {value !== null ? (
                                            <>
                                              <span className="sr-only">{t('steps.seeding.seed', { seed: value })}</span>
                                              <span aria-hidden="true">#{value}</span>
                                            </>
                                          ) : null}
                                        </span>
                                        <span className="min-w-0 truncate">{name(id)}</span>
                                      </li>
                                    )
                                  })}
                                  {Array.from({ length: free }, (_, slot) => (
                                    <li key={`free-${slot}`} className="pl-10 text-muted-foreground italic">
                                      {reset ? t('steps.generation.resetSlot') : t('steps.generation.awaiting')}
                                    </li>
                                  ))}
                                </ul>
                                {bye ? (
                                  <p className="text-xs text-sky-800 dark:text-sky-200">
                                    {t('steps.generation.bye', { points: points(match.bye_points ?? 0) })}
                                  </p>
                                ) : null}
                                {winner ? <p className="text-xs text-muted-foreground">{t('steps.generation.winnerTo', { target: winner })}</p> : null}
                                {loser ? <p className="text-xs text-muted-foreground">{t('steps.generation.loserTo', { target: loser })}</p> : null}
                              </li>
                            )
                          })}
                        </ol>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
