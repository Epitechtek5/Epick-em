import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { StateMessage } from '@/components/games/StateMessage'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useUsernames } from '@/hooks/use-usernames'
import type { Identity } from '@/hooks/use-participant-identities'
import { listTournamentTeamMembers } from '@/features/teams/api'
import { apiRequest } from '@/lib/api/client'
import { useI18n } from '@/i18n/context'
import type { Match } from '@/features/matches/types'
import type { Report, ReportGame } from '@/features/matches/workflow-types'

type Stat = {
  id: string
  key: string
  name: string
  type: 'flat' | 'percent' | 'select' | 'mvp'
  scope?: 'participant' | 'match'
  options?: { key: string; label: string }[]
}
type Values = Record<string, string>
type Row = {
  id: string
  rank: string
  total: Values
  players: Record<string, Values>
}
type Draft = { attributes: Values; rows: Row[] }
const selectStyle =
  'min-h-10 w-full rounded-lg border border-input bg-background px-3 text-foreground focus-visible:outline-2 focus-visible:outline-ring'

export function MatchReportEditor({
  match,
  identity,
  busy,
  label,
  onSubmit,
  onChange,
}: {
  match: Match
  identity: (id: string) => Identity
  busy: boolean
  label: string
  onSubmit: (report: Report) => void
  onChange?: () => void
}) {
  const { t } = useI18n()
  const rosterKey = match.participants
    .map((p) => identity(p.participant_id).teamId ?? '')
    .join(',')
  const resource = useAsyncResource(
    async (signal) => {
      const [stats, rosters] = await Promise.all([
        apiRequest<Stat[]>(`/games/${match.game_id}/stats`, { signal }),
        Promise.all(
          match.participants.map(async (p) => {
            const team = identity(p.participant_id).teamId
            return [
              p.participant_id,
              team ? await listTournamentTeamMembers(team, signal) : null,
            ] as const
          }),
        ),
      ])
      return { stats, rosters: Object.fromEntries(rosters) }
    },
    [match.id, match.game_id, rosterKey],
  )
  const config =
    resource.state.status === 'success' ? resource.state.data : null
  const usernames = useUsernames(
    Object.values(config?.rosters ?? {}).flatMap((r) =>
      (r ?? []).map((p) => p.user_id),
    ),
  )
  const blank = (): Draft => ({
    attributes: {},
    rows: match.participants.map((p) => ({
      id: p.participant_id,
      rank: '',
      total: {},
      players: {},
    })),
  })
  const [games, updateGames] = useState<Draft[]>(() => [blank()])
  const setGames = (next: Draft[] | ((previous: Draft[]) => Draft[])) => {
    onChange?.()
    updateGames(next)
  }
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState(false)
  if (!config)
    return (
      <StateMessage
        kind={resource.state.status === 'error' ? 'error' : 'loading'}
        action={
          <Button variant="outline" onClick={resource.reload}>
            {t('common.retry')}
          </Button>
        }
      >
        {t('matches.loadingStats')}
      </StateMessage>
    )
  const game = games[selected]
  const numeric = config.stats.filter(
    (s) => s.scope !== 'match' && s.type !== 'mvp',
  )
  const attributes = config.stats.filter(
    (s) => s.scope === 'match' && s.type !== 'mvp',
  )
  const candidates = match.participants.flatMap(
    (p) =>
      config.rosters[p.participant_id]?.map((m) => ({
        id: m.user_id,
        name: usernames[m.user_id] ?? t('teams.unknownUser'),
      })) ?? [{ id: p.participant_id, name: identity(p.participant_id).name }],
  )
  const change = (patch: Partial<Draft>) =>
    setGames((old) =>
      old.map((g, i) => (i === selected ? { ...g, ...patch } : g)),
    )
  const rowChange = (id: string, patch: Partial<Row>) =>
    change({
      rows: game.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    })
  function values(raw: Values, stats: Stat[]): Record<string, string | number> {
    return Object.fromEntries(
      stats.flatMap<[string, string | number]>((s) => {
        const value = raw[s.key]?.trim()
        if (!value) return []
        if (s.type === 'select') {
          if (!s.options?.some((o) => o.key === value)) throw new Error()
          return [[s.key, value]]
        }
        const number = Number(value.replace(',', '.'))
        if (
          !Number.isFinite(number) ||
          Math.abs(number) > 1e9 ||
          (s.type === 'percent' && (number < 0 || number > 100))
        )
          throw new Error()
        return [[s.key, number]]
      }),
    )
  }
  function fields(stats: Stat[], raw: Values, onChange: (v: Values) => void) {
    return stats.map((s) => (
      <label key={s.id} className="grid gap-2 text-sm font-medium">
        {s.name}
        {s.type === 'select' ? (
          <select
            className={selectStyle}
            disabled={busy}
            value={raw[s.key] ?? ''}
            onChange={(e) => onChange({ ...raw, [s.key]: e.target.value })}
          >
            <option value="">—</option>
            {s.options?.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <Input
            disabled={busy}
            inputMode="decimal"
            value={raw[s.key] ?? ''}
            onChange={(e) => onChange({ ...raw, [s.key]: e.target.value })}
          />
        )}
      </label>
    ))
  }
  function submit() {
    try {
      const reports: ReportGame[] = games.map((g) => ({
        attributes: {
          ...values(g.attributes, attributes),
          ...Object.fromEntries(
            config!.stats
              .filter((s) => s.type === 'mvp')
              .flatMap((s) =>
                g.attributes[s.key] ? [[s.key, g.attributes[s.key]]] : [],
              ),
          ),
        },
        results: g.rows.map((row) => {
          const rank = Number(row.rank)
          if (!Number.isInteger(rank) || rank < 1 || rank > g.rows.length)
            throw new Error()
          return {
            participant_id: row.id,
            rank,
            stats:
              config!.rosters[row.id] !== null
                ? {
                    total: values(row.total, numeric),
                    players: Object.fromEntries(
                      Object.entries(row.players).map(([id, v]) => [
                        id,
                        values(v, numeric),
                      ]),
                    ),
                  }
                : values(row.total, numeric),
          }
        }),
      }))
      setError(false)
      onSubmit({ games: reports })
    } catch {
      setError(true)
    }
  }
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {games.map((_, i) => (
          <Button
            key={i}
            variant={i === selected ? 'default' : 'outline'}
            disabled={busy}
            onClick={() => setSelected(i)}
            aria-pressed={i === selected}
          >
            {t('matchWorkflow.game')} {i + 1}
          </Button>
        ))}
      </div>
      {fields(attributes, game.attributes, (attributes) =>
        change({ attributes }),
      )}
      {config.stats
        .filter((s) => s.type === 'mvp')
        .map((s) => (
          <label key={s.id} className="grid gap-2">
            {s.name}
            <select
              disabled={busy}
              className={selectStyle}
              value={game.attributes[s.key] ?? ''}
              onChange={(e) =>
                change({
                  attributes: { ...game.attributes, [s.key]: e.target.value },
                })
              }
            >
              <option value="">—</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      <div className="grid gap-4 md:grid-cols-2">
        {game.rows.map((row) => (
          <fieldset
            key={row.id}
            className="grid content-start gap-3 rounded-xl border p-4"
          >
            <legend className="px-1 font-semibold">
              {identity(row.id).name}
            </legend>
            <label className="grid gap-2">
              {t('matchWorkflow.rank')}
              <Input
                disabled={busy}
                type="number"
                min={1}
                max={game.rows.length}
                value={row.rank}
                onChange={(e) => rowChange(row.id, { rank: e.target.value })}
              />
            </label>
            {fields(numeric, row.total, (total) =>
              rowChange(row.id, { total }),
            )}
            {(config.rosters[row.id] ?? []).map((player) => (
              <details key={player.user_id}>
                <summary className="cursor-pointer py-2 font-medium">
                  {usernames[player.user_id] ?? t('teams.unknownUser')}
                </summary>
                <div className="grid gap-3">
                  {fields(numeric, row.players[player.user_id] ?? {}, (v) =>
                    rowChange(row.id, {
                      players: { ...row.players, [player.user_id]: v },
                    }),
                  )}
                </div>
              </details>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {games.length < (match.best_of ?? 1) ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setGames([...games, blank()])
              setSelected(games.length)
            }}
          >
            {t('matchWorkflow.addGame')}
          </Button>
        ) : null}
        {games.length > 1 ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setGames(games.slice(0, -1))
              setSelected(Math.min(selected, games.length - 2))
            }}
          >
            {t('matchWorkflow.removeGame')}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-destructive">
          {t('matchWorkflow.invalid')}
        </p>
      ) : null}
      <Button disabled={busy || match.participants.length < 2} onClick={submit}>
        {label}
      </Button>
    </div>
  )
}
