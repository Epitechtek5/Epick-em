import { isTeamStats, totalsOf } from '@/features/matches/validation'
import { formatStatValue } from '@/features/matches/format'
import type { ParticipantStats } from '@/features/matches/types'
import type { Stat } from '@/features/stats/types'
import { useUsernames } from '@/hooks/use-usernames'
import { useI18n } from '@/i18n/context'

// Statistiques d'un participant (match ou partie), avec le détail par joueur d'une équipe.
export function StatsCell({ stats, statOf }: { stats: ParticipantStats; statOf: (key: string) => Stat | undefined }) {
  const { t, lang } = useI18n()
  const totals = Object.entries(totalsOf(stats))
  const players = isTeamStats(stats) ? Object.entries(stats.players ?? {}) : []
  const names = useUsernames(players.map(([id]) => id))
  const name = (key: string) => statOf(key)?.name ?? key
  if (totals.length === 0 && players.length === 0) return <span className="text-muted-foreground">{t('matches.noStatsEntered')}</span>
  return (
    <div className="grid gap-1">
      {totals.length > 0 ? (
        <dl className="flex flex-wrap gap-x-3 gap-y-1">
          {totals.map(([key, value]) => (
            <div key={key} className="flex gap-1">
              <dt className="text-muted-foreground">{name(key)}</dt>
              <dd className={typeof value === 'number' ? 'font-mono tabular-nums' : 'font-medium'}>
                {formatStatValue(statOf(key), value, lang)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {players.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:underline">{t('matches.playerStats')}</summary>
          <ul className="mt-1 grid gap-1">
            {players.map(([id, values]) => (
              <li key={id}>
                <span className="font-medium">{names[id] ?? t('teams.unknownUser')}</span>{' '}
                {Object.entries(values)
                  .map(([key, value]) => `${name(key)} ${formatStatValue(statOf(key), value, lang)}`)
                  .join(' · ')}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
