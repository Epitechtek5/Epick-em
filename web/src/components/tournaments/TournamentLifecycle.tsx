import { Cancel01Icon, CheckmarkCircle02Icon, Login03Icon, PlayIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { StateMessage } from '@/components/games/StateMessage'
import { setTournamentStatus } from '@/features/tournaments/api'
import { serverDetail, tournamentErrorKey } from '@/features/tournaments/errors'
import { statusLabelKey, transitionLabelKey } from '@/features/tournaments/labels'
import { nextStatuses } from '@/features/tournaments/lifecycle'
import type { Tournament, TournamentStatus } from '@/features/tournaments/types'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

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

interface Feedback {
  kind: 'success' | 'error'
  key: MessageKey
  detail?: string
}

// Cycle de vie (administrateurs) : seules les transitions valides depuis le statut actuel sont
// proposées, chacune après confirmation. Le serveur reste juge (409 transition impossible,
// 400 conditions de démarrage non remplies, détaillées dans errors.status).
export function TournamentLifecycle({
  tournament,
  onChanged,
}: {
  tournament: Tournament
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
    <section aria-labelledby="tournament-lifecycle-title" className="grid gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
      <h2 id="tournament-lifecycle-title" className="text-lg font-semibold">
        {t('tournaments.lifecycle.title')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('tournaments.lifecycle.hint')}</p>

      {feedback ? (
        <StateMessage kind={feedback.kind}>
          {t(feedback.key, { status: t(statusLabelKey(tournament.status)) })}
          {feedback.detail ? <span className="mt-1 block">{feedback.detail}</span> : null}
        </StateMessage>
      ) : null}

      {targets.length === 0 ? (
        <p className="text-sm">{t('tournaments.lifecycle.final')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {targets.map((target) => (
            <ConfirmDialog
              key={target}
              icon={ICONS[target]}
              variant={target === 'cancelled' ? 'destructive' : 'outline'}
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
      )}
    </section>
  )
}
