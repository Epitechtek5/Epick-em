import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Flag02Icon,
  Login03Icon,
  PlayIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { StateMessage } from '@/components/games/StateMessage'
import { Icon } from '@/components/ui/icon'
import { setTournamentStatus } from '@/features/tournaments/api'
import { serverDetail, tournamentErrorKey } from '@/features/tournaments/errors'
import { statusLabelKey, transitionLabelKey } from '@/features/tournaments/labels'
import { nextStatuses } from '@/features/tournaments/lifecycle'
import type { Tournament, TournamentStatus } from '@/features/tournaments/types'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'
import { cn } from '@/lib/utils'
import { SectionCard } from './ui'

const ICONS = {
  draft: Login03Icon,
  registration: Login03Icon,
  ongoing: PlayIcon,
  finished: CheckmarkCircle02Icon,
  cancelled: Cancel01Icon,
} as const

const CONFIRM: Record<TournamentStatus, MessageKey> = {
  draft: 'tournaments.lifecycle.confirmDraft',
  registration: 'tournaments.lifecycle.confirmRegistration',
  ongoing: 'tournaments.lifecycle.confirmOngoing',
  finished: 'tournaments.lifecycle.confirmFinished',
  cancelled: 'tournaments.lifecycle.confirmCancelled',
}

const STEPS: TournamentStatus[] = ['draft', 'registration', 'ongoing', 'finished']

interface Feedback {
  kind: 'success' | 'error'
  key: MessageKey
  detail?: string
}

// Frise du cycle de vie (pour tous) : étapes passées, en cours et à venir, écrites en texte.
function Stepper({ status }: { status: TournamentStatus }) {
  const { t } = useI18n()
  const current = STEPS.indexOf(status)
  return (
    <ol className="grid gap-3 sm:grid-cols-4 sm:gap-0">
      {STEPS.map((step, index) => {
        const state = status === 'cancelled' ? 'upcoming' : index < current ? 'done' : index === current ? 'current' : 'upcoming'
        return (
          <li
            key={step}
            aria-current={state === 'current' ? 'step' : undefined}
            className="relative flex items-center gap-3 sm:flex-col sm:items-center sm:text-center"
          >
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-5 right-1/2 hidden h-0.5 w-full -translate-y-1/2 sm:block',
                  index <= current && status !== 'cancelled' ? 'bg-primary' : 'bg-border',
                )}
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
              <span className={cn('text-sm', state === 'current' ? 'font-bold' : 'font-medium', state === 'upcoming' && 'text-muted-foreground')}>
                {t(statusLabelKey(step))}
              </span>
              <span className="text-xs text-muted-foreground">
                {t(
                  state === 'done'
                    ? 'tournaments.lifecycle.stepDone'
                    : state === 'current'
                      ? 'tournaments.lifecycle.stepCurrent'
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

// Cycle de vie : frise pour tous ; pour les administrateurs, seules les transitions valides
// depuis le statut actuel sont proposées, chacune après confirmation. Le serveur reste juge
// (409 transition impossible, 400 conditions de démarrage non remplies dans errors.status).
export function TournamentLifecycle({
  tournament,
  canManage,
  onChanged,
}: {
  tournament: Tournament
  canManage: boolean
  onChanged: (tournament: Tournament) => void
}) {
  const { t } = useI18n()
  const { refreshRole } = useAuth()
  const [busy, setBusy] = useState<TournamentStatus | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const targets = nextStatuses(tournament.status)

  async function change(target: TournamentStatus) {
    setBusy(target)
    setFeedback(null)
    try {
      const updated = await setTournamentStatus(tournament.id, target)
      setFeedback({ kind: 'success', key: 'tournaments.lifecycle.changed' })
      onChanged(updated)
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      setFeedback({ kind: 'error', key: tournamentErrorKey(error), detail: serverDetail(error, 'status') })
    } finally {
      setBusy(null)
    }
  }

  return (
    <SectionCard
      id="tournament-lifecycle-title"
      icon={Flag02Icon}
      title={t('tournaments.lifecycle.title')}
      subtitle={canManage ? t('tournaments.lifecycle.hint') : undefined}
    >
      <Stepper status={tournament.status} />

      {tournament.status === 'cancelled' ? (
        <p className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800 dark:bg-red-500/15 dark:text-red-200">
          <Icon icon={Cancel01Icon} />
          {t('tournaments.lifecycle.cancelledBanner')}
        </p>
      ) : null}

      {feedback ? (
        <StateMessage kind={feedback.kind}>
          {t(feedback.key, { status: t(statusLabelKey(tournament.status)) })}
          {feedback.detail ? <span className="mt-1 block">{feedback.detail}</span> : null}
        </StateMessage>
      ) : null}

      {canManage ? (
        targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('tournaments.lifecycle.final')}</p>
        ) : (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            {targets.map((target) => (
              <ConfirmDialog
                key={target}
                icon={ICONS[target]}
                variant={target === 'cancelled' ? 'destructive' : 'default'}
                label={t(transitionLabelKey(target))}
                busyLabel={t('tournaments.lifecycle.changing')}
                title={t('tournaments.lifecycle.confirmTitle', { status: t(statusLabelKey(target)) })}
                description={t(CONFIRM[target], { name: tournament.name })}
                busy={busy === target}
                disabled={busy !== null}
                onConfirm={() => void change(target)}
              />
            ))}
          </div>
        )
      ) : null}
    </SectionCard>
  )
}
