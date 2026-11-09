import {
  CheckmarkCircle02Icon,
  Flag02Icon,
  InformationCircleIcon,
  PlayIcon,
  StopIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link } from 'react-router'

import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { StateMessage } from '@/components/games/StateMessage'
import { SectionCard } from '@/components/tournaments/ui'
import { Icon } from '@/components/ui/icon'
import { closeStep, startStep } from '@/features/steps/api'
import { startDetail, stepErrorKey } from '@/features/steps/errors'
import { stepStatusLabelKey } from '@/features/steps/labels'
import { STEP_STATUSES, type Step } from '@/features/steps/types'
import { canClose, canStart, startBlocker } from '@/features/steps/validation'
import type { Tournament } from '@/features/tournaments/types'
import { useI18n, type MessageKey, type Params } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'
import { cn } from '@/lib/utils'

interface Feedback {
  kind: 'success' | 'error'
  key: MessageKey
  params?: Params
  detail?: string
  // Étape suivante après une clôture : ouverte automatiquement, ou restée en attente.
  next?: { step: Step; opened: boolean } | null
}

// Frise du statut de l'étape (en attente → en cours → terminée), écrite en texte.
function Stepper({ status }: { status: Step['status'] }) {
  const { t } = useI18n()
  const current = STEP_STATUSES.indexOf(status)
  return (
    <ol className="grid gap-3 sm:grid-cols-3 sm:gap-0">
      {STEP_STATUSES.map((value, index) => {
        const state = index < current || status === 'finished' ? 'done' : index === current ? 'current' : 'upcoming'
        return (
          <li
            key={value}
            aria-current={index === current ? 'step' : undefined}
            className="relative flex items-center gap-3 sm:flex-col sm:items-center sm:text-center"
          >
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={cn('absolute top-5 right-1/2 hidden h-0.5 w-full -translate-y-1/2 sm:block', index <= current ? 'bg-primary' : 'bg-border')}
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                'relative z-10 grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold ring-4 ring-card',
                state === 'done' && 'bg-primary text-primary-foreground',
                state === 'current' && 'bg-primary text-primary-foreground shadow-lg shadow-primary/30 outline-2 outline-offset-2 outline-primary',
                state === 'upcoming' && 'bg-muted text-muted-foreground',
              )}
            >
              {state === 'done' ? <Icon icon={Tick02Icon} size={18} /> : index + 1}
            </span>
            <span className="grid">
              <span className={cn('text-sm', index === current ? 'font-bold' : 'font-medium', state === 'upcoming' && 'text-muted-foreground')}>
                {t(stepStatusLabelKey(value))}
              </span>
              <span className="text-xs text-muted-foreground">
                {t(
                  index === current
                    ? 'tournaments.lifecycle.stepCurrent'
                    : state === 'done'
                      ? 'tournaments.lifecycle.stepDone'
                      : 'tournaments.lifecycle.stepUpcoming',
                )}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// Déroulement d'une étape : frise pour tous ; lancement et clôture pour les administrateurs,
// chacun après confirmation explicite. Le serveur reste juge : 400 (chaînage, nombre de
// participants, détail affiché tel quel) et 409 (statut, étapes précédentes) sont expliqués.
export function StepLifecycle({
  tournament,
  step,
  steps,
  canManage,
  onChanged,
}: {
  tournament: Tournament
  step: Step
  steps: readonly Step[]
  canManage: boolean
  // Étapes renvoyées par le serveur (l'étape, et la suivante si elle s'est ouverte).
  onChanged: (updated: Step[]) => void
}) {
  const { t } = useI18n()
  const { refreshRole } = useAuth()
  const [busy, setBusy] = useState<'start' | 'close' | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const blocker = startBlocker(tournament, step, steps)
  const following = steps.filter((other) => other.position > step.position).sort((a, b) => a.position - b.position)[0]

  async function run(action: 'start' | 'close') {
    setBusy(action)
    setFeedback(null)
    try {
      if (action === 'start') {
        const started = await startStep(tournament.id, step.id)
        setFeedback({ kind: 'success', key: 'steps.lifecycle.started', params: { position: started.position } })
        onChanged([started])
      } else {
        const result = await closeStep(tournament.id, step.id)
        const next = result.next_step
          ? { step: result.next_step, opened: true }
          : following
            ? { step: following, opened: false }
            : null
        setFeedback({ kind: 'success', key: 'steps.lifecycle.closed', params: { position: result.step.position }, next })
        onChanged(result.next_step ? [result.step, result.next_step] : [result.step])
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      setFeedback({ kind: 'error', key: stepErrorKey(error, action), detail: startDetail(error) })
    } finally {
      setBusy(null)
    }
  }

  const stepLink = (target: Step) => (
    <Link to={`/tournaments/${tournament.id}/steps/${target.id}`} className="font-medium text-primary underline underline-offset-4 dark:text-violet-300">
      {t('steps.lifecycle.openStep', { position: target.position })}
    </Link>
  )

  return (
    <SectionCard
      id="step-lifecycle-title"
      icon={Flag02Icon}
      title={t('steps.lifecycle.title')}
      subtitle={canManage ? t('steps.lifecycle.hint') : undefined}
    >
      <Stepper status={step.status} />

      {feedback ? (
        <StateMessage kind={feedback.kind}>
          {t(feedback.key, feedback.params)}
          {feedback.detail ? <span className="mt-1 block">{feedback.detail}</span> : null}
          {feedback.next ? (
            <span className="mt-1 block">
              {feedback.next.opened
                ? t('steps.lifecycle.nextOpened', { position: feedback.next.step.position })
                : t('steps.lifecycle.nextManual')}{' '}
              {stepLink(feedback.next.step)}
            </span>
          ) : null}
        </StateMessage>
      ) : null}

      {step.status === 'finished' ? (
        <p className="flex items-start gap-2 rounded-xl bg-sky-50 px-4 py-3 text-sm font-medium text-sky-900 dark:bg-sky-500/15 dark:text-sky-100">
          <Icon icon={CheckmarkCircle02Icon} size={18} className="mt-0.5 shrink-0" />
          <span>
            {t('steps.lifecycle.finished')} {t('steps.lifecycle.tournamentEnds')}
          </span>
        </p>
      ) : null}

      {canManage && step.status !== 'finished' ? (
        <div className="grid gap-3 border-t pt-4">
          {blocker ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Icon icon={InformationCircleIcon} size={18} className="mt-0.5 shrink-0" />
              {t(blocker)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {step.status === 'pending' ? (
              <ConfirmDialog
                icon={PlayIcon}
                variant="default"
                label={t('steps.lifecycle.start')}
                busyLabel={t('steps.lifecycle.starting')}
                title={t('steps.lifecycle.confirmStartTitle', { position: step.position })}
                description={t('steps.lifecycle.confirmStart', { groups: step.group_count })}
                busy={busy === 'start'}
                disabled={busy !== null || !canStart(tournament, step, steps)}
                onConfirm={() => void run('start')}
              />
            ) : null}
            {canClose(step) ? (
              <ConfirmDialog
                icon={StopIcon}
                variant="default"
                label={t('steps.lifecycle.close')}
                busyLabel={t('steps.lifecycle.closing')}
                title={t('steps.lifecycle.confirmCloseTitle', { position: step.position })}
                description={t('steps.lifecycle.confirmClose', { advance: step.advance_per_group })}
                busy={busy === 'close'}
                disabled={busy !== null}
                onConfirm={() => void run('close')}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <Icon icon={InformationCircleIcon} size={18} className="mt-0.5 shrink-0" />
        {t('steps.matches.limits')}
      </p>
    </SectionCard>
  )
}
