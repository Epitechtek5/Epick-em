import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Label } from '@/components/ui/label'
import { linkStat, listAllStats, listGameStats, unlinkStat } from '@/features/stats/api'
import { statErrorKey } from '@/features/stats/errors'
import { statTypeLabelKey } from '@/features/stats/labels'
import type { Stat } from '@/features/stats/types'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useI18n, type MessageKey, type Params } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

interface Feedback {
  kind: 'success' | 'error'
  key: MessageKey
  params?: Params
}

// Statistiques d'un jeu (GET /games/{id}/stats). Lecture seule pour user et watcher ;
// les administrateurs associent (PUT) et retirent (DELETE) des statistiques existantes,
// et la liste est relue après chaque modification.
export function GameStatsSection({ gameId }: { gameId: string }) {
  const { t } = useI18n()
  const { isAdmin, refreshRole } = useAuth()
  const { state, reload } = useAsyncResource((signal) => listGameStats(gameId, signal), [gameId])
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function mutate(stat: Stat, action: 'link' | 'unlink') {
    setBusyId(stat.id)
    setFeedback(null)
    try {
      if (action === 'link') await linkStat(gameId, stat.id)
      else await unlinkStat(gameId, stat.id)
      setFeedback({
        kind: 'success',
        key: action === 'link' ? 'gameStats.linked' : 'gameStats.removed',
        params: { name: stat.name },
      })
      reload()
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      setFeedback({ kind: 'error', key: statErrorKey(error) })
      // Une liaison absente (404) signifie que la liste affichée est périmée.
      if (error instanceof ApiError && error.status === 404) reload()
    } finally {
      setBusyId(null)
    }
  }

  const linked = state.status === 'success' ? state.data : []

  return (
    <section aria-labelledby="game-stats-title" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="game-stats-title" className="text-lg font-semibold">
          {t('gameStats.title')}
        </h2>
        {isAdmin ? (
          <Link to="/stats" className="text-sm text-primary underline underline-offset-4">
            {t('gameStats.manage')}
          </Link>
        ) : null}
      </div>

      {feedback ? (
        <StateMessage kind={feedback.kind}>{t(feedback.key, feedback.params)}</StateMessage>
      ) : null}

      {state.status === 'loading' ? (
        <StateMessage kind="loading">{t('gameStats.loading')}</StateMessage>
      ) : null}

      {state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(statErrorKey(state.error))}
        </StateMessage>
      ) : null}

      {state.status === 'success' && linked.length === 0 ? (
        <StateMessage kind="empty">{t('gameStats.empty')}</StateMessage>
      ) : null}

      {linked.length > 0 ? (
        <ul aria-label={t('gameStats.list')} className="grid gap-2">
          {linked.map((stat) => (
            <li
              key={stat.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 ring-1 ring-foreground/10"
            >
              <div className="grid">
                <span className="font-medium">{stat.name}</span>
                <span className="text-sm text-muted-foreground">
                  <code className="font-mono">{stat.key}</code> · {t(statTypeLabelKey(stat.type))} ({stat.type})
                </span>
              </div>
              {isAdmin ? (
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t('gameStats.remove', { name: stat.name })}
                  disabled={busyId === stat.id}
                  onClick={() => mutate(stat, 'unlink')}
                >
                  <Icon icon={Cancel01Icon} />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {isAdmin && state.status === 'success' ? (
        <StatLinker linked={linked} busy={busyId !== null} onLink={(stat) => mutate(stat, 'link')} />
      ) : null}
    </section>
  )
}

// Sélecteur des statistiques existantes pas encore associées au jeu (admin).
function StatLinker({
  linked,
  busy,
  onLink,
}: {
  linked: Stat[]
  busy: boolean
  onLink: (stat: Stat) => void
}) {
  const { t } = useI18n()
  const { state, reload } = useAsyncResource((signal) => listAllStats(signal), [])
  const [selected, setSelected] = useState('')

  if (state.status === 'loading') {
    return <StateMessage kind="loading">{t('stats.loading')}</StateMessage>
  }
  if (state.status === 'error') {
    return (
      <StateMessage
        kind="error"
        action={
          <Button variant="outline" size="sm" onClick={reload}>
            {t('common.retry')}
          </Button>
        }
      >
        {t(statErrorKey(state.error))}
      </StateMessage>
    )
  }

  const linkedIds = new Set(linked.map((stat) => stat.id))
  const available = state.data.filter((stat) => !linkedIds.has(stat.id))
  const choice = available.find((stat) => stat.id === selected)

  if (available.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {state.data.length === 0 ? t('gameStats.noneExisting') : t('gameStats.noneAvailable')}
      </p>
    )
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (choice) {
          onLink(choice)
          setSelected('')
        }
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="game-stat-select">{t('gameStats.select')}</Label>
        <select
          id="game-stat-select"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          className="h-8 min-w-56 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <option value="">{t('gameStats.choose')}</option>
          {available.map((stat) => (
            <option key={stat.id} value={stat.id}>
              {stat.name} ({stat.key})
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={!choice || busy}>
        {busy ? t('gameStats.linking') : t('gameStats.link')}
      </Button>
    </form>
  )
}
