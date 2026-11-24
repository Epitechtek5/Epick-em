import { Add01Icon, CheckListIcon, Edit02Icon, InformationCircleIcon, ViewIcon } from '@hugeicons/core-free-icons'
import { useRef, useState } from 'react'
import { Link } from 'react-router'

import { SectionCard } from '@/components/common/page-blocks'
import { StateMessage } from '@/components/games/StateMessage'
import { MatchStatusBadge } from '@/components/matches/MatchBadges'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { createGame } from '@/features/matches/api'
import { matchErrorDetail, matchErrorKey } from '@/features/matches/errors'
import { formatStatValue } from '@/features/matches/format'
import { canEditGame, gameAttributeStats, seriesWins, startProblem, winsNeeded, type StartProblem } from '@/features/matches/games'
import type { Match, MatchGame } from '@/features/matches/types'
import type { Stat } from '@/features/stats/types'
import type { Step } from '@/features/steps/types'
import type { Identity } from '@/hooks/use-participant-identities'
import { useI18n, type MessageKey } from '@/i18n/context'

const START_HINTS: Partial<Record<StartProblem, MessageKey>> = {
  ongoing: 'matches.games.finishCurrent',
  direct: 'matches.games.direct',
  participants: 'matches.games.needParticipants',
}

// Série d'un match (BO1, BO3, BO5) : parties gagnées, parties jouées avec leurs attributs (carte,
// MVP…) et leur vainqueur, et ouverture de la partie suivante (administrateurs globaux, comme le
// serveur). Les résultats du match restent ceux que le serveur agrège.
export function MatchSeriesSection({
  match,
  step,
  stats,
  identity,
  nameOf,
  canWrite,
  gamePath,
  onStarted,
  onConflict,
}: {
  match: Match
  step: Step
  stats: readonly Stat[]
  identity: (participantId: string) => Identity
  // Nom d'un participant ou d'un joueur (MVP).
  nameOf: (id: string) => string
  // Administrateur global : seul autorisé à écrire les parties.
  canWrite: boolean
  gamePath: (number: number) => string
  onStarted: (game: MatchGame) => void
  onConflict: (error: unknown) => void
}) {
  const { t, lang } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ key: MessageKey; detail?: string } | null>(null)
  const lock = useRef(false)
  const wins = seriesWins(match)
  const problem = startProblem(step, match)
  const attributes = gameAttributeStats(stats)
  const statOf = (key: string) => attributes.find((stat) => stat.key === key)
  const next = match.games.length + 1

  async function start() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      onStarted(await createGame(step.tournament_id, step.id, match.id))
    } catch (caught) {
      onConflict(caught)
      setError({ key: matchErrorKey(caught, 'game'), detail: matchErrorDetail(caught) })
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const winner = (game: MatchGame) => {
    const won = game.participants.filter((participant) => participant.result === 'win')
    if (won.length > 0) return t('matches.games.wonBy', { name: won.map((participant) => identity(participant.participant_id).name).join(', ') })
    return game.participants.some((participant) => participant.result === 'draw') ? t('matches.result.draw') : null
  }

  return (
    <SectionCard
      id="match-series-title"
      icon={CheckListIcon}
      title={t('matches.games.title')}
      subtitle={t(match.best_of === 1 ? 'matches.games.seriesHelpOne' : 'matches.games.seriesHelp', {
        count: match.best_of,
        wins: winsNeeded(match.best_of),
      })}
    >
      {match.games.length > 0 ? (
        <ul aria-label={t('matches.games.score')} className="flex flex-wrap gap-3">
          {match.participants.map((participant) => (
            <li key={participant.participant_id} className="grid min-w-32 flex-1 justify-items-center gap-1 rounded-xl bg-muted/50 p-3 text-center">
              <span className="font-medium">{identity(participant.participant_id).name}</span>
              <span className="text-3xl font-bold text-primary tabular-nums dark:text-violet-300">{wins.get(participant.participant_id) ?? 0}</span>
              <span className="text-xs text-muted-foreground">{t('matches.games.wins')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t(match.best_of === 1 && !problem ? 'matches.games.singleHint' : problem === 'direct' ? 'matches.games.direct' : 'matches.games.empty')}
        </p>
      )}

      {match.games.length > 0 ? (
        <ol aria-label={t('matches.games.list')} className="grid gap-2">
          {match.games.map((game) => {
            const editable = canWrite && canEditGame(step, match, game)
            const result = winner(game)
            return (
              <li key={game.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 ring-1 ring-foreground/10">
                <div className="grid gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{t('matches.games.number', { number: game.number })}</span>
                    <MatchStatusBadge status={game.status} />
                  </span>
                  {Object.keys(game.attributes).length > 0 || result ? (
                    <span className="text-sm text-muted-foreground">
                      {[
                        ...Object.entries(game.attributes).map(
                          ([key, value]) => `${statOf(key)?.name ?? key}${t('common.colon')} ${formatStatValue(statOf(key), value, lang, nameOf)}`,
                        ),
                        ...(result ? [result] : []),
                      ].join(' · ')}
                    </span>
                  ) : null}
                </div>
                <Link
                  to={gamePath(game.number)}
                  className={buttonVariants({ variant: editable ? 'default' : 'outline', size: 'sm' })}
                  aria-label={t(editable ? 'matches.games.enterFor' : 'matches.games.viewFor', { number: game.number })}
                >
                  <Icon icon={editable ? Edit02Icon : ViewIcon} />
                  {t(editable ? 'matches.games.enter' : 'matches.games.view')}
                </Link>
              </li>
            )
          })}
        </ol>
      ) : null}

      {error ? (
        <StateMessage kind="error">
          {t(error.key)}
          {error.detail ? <span className="mt-1 block">{error.detail}</span> : null}
        </StateMessage>
      ) : null}

      {canWrite && problem === null ? (
        <div>
          <Button disabled={busy} onClick={() => void start()}>
            <Icon icon={Add01Icon} />
            {busy ? t('matches.games.starting') : t('matches.games.start', { number: next })}
          </Button>
        </div>
      ) : null}
      {canWrite && problem && START_HINTS[problem] && !(problem === 'direct' && match.games.length === 0) ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Icon icon={InformationCircleIcon} size={18} className="mt-0.5 shrink-0" />
          {t(START_HINTS[problem])}
        </p>
      ) : null}
      {!canWrite && problem === null ? <p className="text-sm text-muted-foreground">{t('matches.games.adminOnly')}</p> : null}
    </SectionCard>
  )
}
