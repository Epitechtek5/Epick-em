import { FloppyDiskIcon, InformationCircleIcon } from '@hugeicons/core-free-icons'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { ErrorSummary, type ErrorSummaryItem } from '@/components/form/ErrorSummary'
import { StatInput } from '@/components/matches/StatInput'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import {
  gameAttributeStats,
  gameRows,
  hasGameErrors,
  mvpCandidates,
  toGameResults,
  validateGame,
  winnerOf,
  withWinner,
  type GameErrors,
  type GameRow,
  type Rosters,
} from '@/features/matches/games'
import type { GameAttributes, GameResultsInput, MatchGame } from '@/features/matches/types'
import { participantStatsOf } from '@/features/matches/validation'
import { statTypeLabelKey } from '@/features/stats/labels'
import type { Stat } from '@/features/stats/types'
import type { Identity } from '@/hooks/use-participant-identities'
import { useI18n, type MessageKey } from '@/i18n/context'

const EMPTY_ERRORS: GameErrors = { rows: {}, attributes: {} }

// Saisie des résultats d'une partie en cours (PUT …/games/{number}/results, administrateur) :
// attributs de la partie (carte, MVP…), statistiques de chaque participant (total d'une équipe et
// détail par joueur), rang. Validée comme le serveur avant l'envoi ; points, rangs définitifs et
// agrégation de la série restent calculés par le serveur.
export function GameResultsForm({
  game,
  stats,
  scored,
  rosters,
  identity,
  playerName,
  busy,
  formError,
  formDetail,
  onChange,
  onSubmit,
}: {
  game: MatchGame
  stats: readonly Stat[]
  scored: ReadonlySet<string>
  rosters: Rosters
  identity: (participantId: string) => Identity
  playerName: (userId: string) => string
  busy: boolean
  formError?: MessageKey | null
  formDetail?: string
  // Signale une modification non enregistrée (la fin de partie attend l'enregistrement).
  onChange: () => void
  onSubmit: (input: GameResultsInput) => void
}) {
  const { t } = useI18n()
  const summaryRef = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState<GameRow[]>(() => gameRows(game))
  const [attributes, setAttributes] = useState<GameAttributes>(game.attributes)
  const [errors, setErrors] = useState<GameErrors>(EMPTY_ERRORS)
  const [focusSummary, setFocusSummary] = useState(0)

  useEffect(() => {
    if (focusSummary > 0) summaryRef.current?.focus()
  }, [focusSummary])
  useEffect(() => {
    if (formError) summaryRef.current?.focus()
  }, [formError])

  const participantStats = participantStatsOf(stats)
  const attributeStats = gameAttributeStats(stats)
  const candidates = mvpCandidates(game, rosters)
  const candidateName = (id: string) => (game.participants.some((participant) => participant.participant_id === id) ? identity(id).name : playerName(id))
  const duel = rows.length === 2

  function edit(next: GameRow[]) {
    setRows(next)
    onChange()
  }
  const update = (participantId: string, change: (row: GameRow) => GameRow) =>
    edit(rows.map((row) => (row.participant_id === participantId ? change(row) : row)))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const found = validateGame(rows, attributes, stats, candidates)
    setErrors(found)
    if (hasGameErrors(found)) {
      setFocusSummary((n) => n + 1)
      return
    }
    onSubmit(toGameResults(rows, attributes, stats, rosters))
  }

  const cellId = (...parts: string[]) => `game-${parts.join('-')}`
  const statName = (key: string) => stats.find((stat) => stat.key === key)?.name ?? key
  const items: ErrorSummaryItem[] = [
    ...attributeStats.flatMap((stat) =>
      errors.attributes[stat.key] ? [{ fieldId: cellId('attr', stat.key), message: `${stat.name}${t('common.colon')} ${t(errors.attributes[stat.key])}` }] : [],
    ),
    ...rows.flatMap((row) => {
      const found = errors.rows[row.participant_id]
      if (!found) return []
      const name = identity(row.participant_id).name
      return [
        ...Object.entries(found.total ?? {}).map(([key, message]) => ({
          fieldId: cellId(row.participant_id, key),
          message: `${name} · ${statName(key)}${t('common.colon')} ${t(message)}`,
        })),
        ...Object.entries(found.players ?? {}).flatMap(([player, cells]) =>
          Object.entries(cells).map(([key, message]) => ({
            fieldId: cellId(row.participant_id, player, key),
            message: `${playerName(player)} · ${statName(key)}${t('common.colon')} ${t(message)}`,
          })),
        ),
        ...(found.rank ? [{ fieldId: cellId(row.participant_id, 'rank'), message: `${name}${t('common.colon')} ${t(found.rank, { max: rows.length })}` }] : []),
      ]
    }),
    ...(errors.ranks ? [{ message: t(errors.ranks) }] : []),
    ...(formError ? [{ message: formDetail ? `${t(formError)} ${formDetail}` : t(formError) }] : []),
  ]

  const errorText = (id: string, message: string | undefined) =>
    message ? (
      <p id={`${id}-error`} className="mt-1 text-xs text-destructive">
        <span className="font-medium">{t('common.error')}</span> {message}
      </p>
    ) : null

  const statHeader = (stat: Stat) => (
    <th key={stat.id} scope="col" className="px-3 py-2 font-medium">
      <span className="block">{stat.name}</span>
      <span className="block text-xs font-normal text-muted-foreground">
        <code>{stat.key}</code> · {t(statTypeLabelKey(stat.type))}
        {scored.has(stat.id) ? ` · ${t('matches.scored')}` : ''}
      </span>
    </th>
  )

  const teams = rows.filter((row) => (rosters[row.participant_id]?.length ?? 0) > 0)

  return (
    <form onSubmit={submit} noValidate aria-busy={busy} className="grid gap-5">
      <ErrorSummary ref={summaryRef} items={items} title={t('matches.validation.fixErrors')} />
      <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <Icon icon={InformationCircleIcon} size={18} className="mt-0.5 shrink-0" />
        <span>
          {t('matches.games.entryHint')} {participantStats.length === 0 ? t('matches.games.noStats') : null}
        </span>
      </p>

      {attributeStats.length > 0 || duel ? (
        <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold">{t('matches.games.attributes')}</legend>
          {attributeStats.map((stat) => {
            const id = cellId('attr', stat.key)
            const value = attributes[stat.key] ?? ''
            const choices =
              stat.type === 'mvp'
                ? candidates.map((candidate) => ({ key: candidate, label: candidateName(candidate) }))
                : (stat.options ?? [])
            const message = errors.attributes[stat.key]
            return (
              <div key={stat.id} className="grid gap-1">
                <Label htmlFor={id}>{stat.name}</Label>
                <NativeSelect
                  id={id}
                  value={value}
                  aria-invalid={message ? true : undefined}
                  aria-describedby={message ? `${id}-error` : undefined}
                  onChange={(event) => {
                    setAttributes({ ...attributes, [stat.key]: event.target.value })
                    onChange()
                  }}
                >
                  <option value="">{t('matches.games.unset')}</option>
                  {value && !choices.some((choice) => choice.key === value) ? (
                    <option value={value}>{t('matches.games.unavailableOption', { value })}</option>
                  ) : null}
                  {choices.map((choice) => (
                    <option key={choice.key} value={choice.key}>
                      {choice.label}
                    </option>
                  ))}
                </NativeSelect>
                {stat.type === 'select' && choices.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('stats.noOptions')}</p>
                ) : null}
                {errorText(id, message ? t(message) : undefined)}
              </div>
            )
          })}
          {duel ? (
            <div className="grid gap-1">
              <Label htmlFor="game-winner">{t('matches.games.winner')}</Label>
              <NativeSelect id="game-winner" value={winnerOf(rows)} onChange={(event) => edit(withWinner(rows, event.target.value))}>
                <option value="">{t('matches.games.fromPoints')}</option>
                {rows.map((row) => (
                  <option key={row.participant_id} value={row.participant_id}>
                    {identity(row.participant_id).name}
                  </option>
                ))}
                <option value="draw">{t('matches.result.draw')}</option>
              </NativeSelect>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full min-w-max text-left text-sm">
          <caption className="sr-only">{t('matches.games.resultsOf', { number: game.number })}</caption>
          <thead>
            <tr className="border-b bg-muted/60 align-bottom">
              <th scope="col" className="px-3 py-2 font-medium">
                {t('matches.participant')}
              </th>
              {participantStats.map(statHeader)}
              <th scope="col" className="px-3 py-2 font-medium">
                {t('matches.rankOptional')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const who = identity(row.participant_id)
              const found = errors.rows[row.participant_id]
              const team = (rosters[row.participant_id]?.length ?? 0) > 0
              return (
                <tr key={row.participant_id} className="border-b align-top last:border-0">
                  <th scope="row" className="px-3 py-2 font-medium">
                    <span className="block">{who.name}</span>
                    {team ? <span className="block text-xs font-normal text-muted-foreground">{t('matches.games.teamTotals')}</span> : null}
                    {who.detail ? <span className="block text-xs font-normal text-muted-foreground">{who.detail}</span> : null}
                  </th>
                  {participantStats.map((stat) => {
                    const id = cellId(row.participant_id, stat.key)
                    const message = found?.total?.[stat.key]
                    return (
                      <td key={stat.id} className="px-3 py-2">
                        <StatInput
                          id={id}
                          stat={stat}
                          label={t('matches.statFor', { stat: stat.name, name: who.name })}
                          value={row.total[stat.key] ?? ''}
                          invalid={message !== undefined}
                          onChange={(value) => update(row.participant_id, (current) => ({ ...current, total: { ...current.total, [stat.key]: value } }))}
                        />
                        {errorText(id, message ? t(message) : undefined)}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2">
                    <Input
                      id={cellId(row.participant_id, 'rank')}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={rows.length}
                      step={1}
                      className="w-20"
                      aria-label={t('matches.rankFor', { name: who.name })}
                      value={row.rank}
                      aria-invalid={found?.rank ? true : undefined}
                      aria-describedby={found?.rank ? `${cellId(row.participant_id, 'rank')}-error` : undefined}
                      onChange={(event) => update(row.participant_id, (current) => ({ ...current, rank: event.target.value }))}
                    />
                    {errorText(cellId(row.participant_id, 'rank'), found?.rank ? t(found.rank, { max: rows.length }) : undefined)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {participantStats.length > 0
        ? teams.map((row) => {
            const who = identity(row.participant_id)
            const members = rosters[row.participant_id] ?? []
            const found = errors.rows[row.participant_id]?.players
            return (
              <div key={row.participant_id} className="grid gap-2">
                <h3 className="text-sm font-semibold">{t('matches.games.playersOf', { name: who.name })}</h3>
                <p className="text-xs text-muted-foreground">{t('matches.games.playersHint')}</p>
                <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
                  <table className="w-full min-w-max text-left text-sm">
                    <caption className="sr-only">{t('matches.games.playersOf', { name: who.name })}</caption>
                    <thead>
                      <tr className="border-b bg-muted/60 align-bottom">
                        <th scope="col" className="px-3 py-2 font-medium">
                          {t('matches.games.player')}
                        </th>
                        {participantStats.map(statHeader)}
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((member) => {
                        const name = playerName(member)
                        return (
                          <tr key={member} className="border-b align-top last:border-0">
                            <th scope="row" className="px-3 py-2 font-medium">
                              {name}
                            </th>
                            {participantStats.map((stat) => {
                              const id = cellId(row.participant_id, member, stat.key)
                              const message = found?.[member]?.[stat.key]
                              return (
                                <td key={stat.id} className="px-3 py-2">
                                  <StatInput
                                    id={id}
                                    stat={stat}
                                    label={t('matches.statFor', { stat: stat.name, name })}
                                    value={row.players[member]?.[stat.key] ?? ''}
                                    invalid={message !== undefined}
                                    onChange={(value) =>
                                      update(row.participant_id, (current) => ({
                                        ...current,
                                        players: { ...current.players, [member]: { ...current.players[member], [stat.key]: value } },
                                      }))
                                    }
                                  />
                                  {errorText(id, message ? t(message) : undefined)}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })
        : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          <Icon icon={FloppyDiskIcon} />
          {busy ? t('matches.saving') : t('matches.games.save')}
        </Button>
      </div>
    </form>
  )
}
