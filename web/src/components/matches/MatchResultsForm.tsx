import { FloppyDiskIcon, InformationCircleIcon } from '@hugeicons/core-free-icons'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { ErrorSummary, type ErrorSummaryItem } from '@/components/form/ErrorSummary'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { resultLabelKey } from '@/features/matches/labels'
import { MATCH_RESULTS, type Match, type MatchResult, type ResultErrors, type ResultRow } from '@/features/matches/types'
import { partialRanks, resultRows, validateResults } from '@/features/matches/validation'
import { statTypeLabelKey } from '@/features/stats/labels'
import type { Stat } from '@/features/stats/types'
import type { Identity } from '@/hooks/use-participant-identities'
import { useI18n, type MessageKey } from '@/i18n/context'

// Saisie des résultats d'un match (PUT …/results) avec les statistiques liées au jeu du tournoi,
// validées comme le serveur avant l'envoi. Les points, rangs et résultats définitifs restent ceux
// que le serveur renvoie.
export function MatchResultsForm({
  match,
  stats,
  scored,
  identity,
  busy,
  formError,
  formDetail,
  onSubmit,
}: {
  match: Match
  stats: readonly Stat[]
  // Statistiques comptées par le barème du tournoi.
  scored: ReadonlySet<string>
  identity: (participantId: string) => Identity
  busy: boolean
  formError?: MessageKey | null
  formDetail?: string
  onSubmit: (rows: ResultRow[]) => void
}) {
  const { t } = useI18n()
  const summaryRef = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState<ResultRow[]>(() => resultRows(match))
  const [errors, setErrors] = useState<ResultErrors>({})
  const [focusSummary, setFocusSummary] = useState(0)

  useEffect(() => {
    if (focusSummary > 0) summaryRef.current?.focus()
  }, [focusSummary])
  useEffect(() => {
    if (formError) summaryRef.current?.focus()
  }, [formError])

  const update = (participantId: string, change: (row: ResultRow) => ResultRow) =>
    setRows((current) => current.map((row) => (row.participant_id === participantId ? change(row) : row)))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const found = validateResults(rows, stats)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setFocusSummary((n) => n + 1)
      return
    }
    onSubmit(rows)
  }

  const cellId = (participantId: string, field: string) => `result-${participantId}-${field}`
  const items: ErrorSummaryItem[] = [
    ...rows.flatMap((row) => {
      const found = errors[row.participant_id]
      if (!found) return []
      const name = identity(row.participant_id).name
      return [
        ...Object.entries(found.stats ?? {}).map(([key, message]) => ({
          fieldId: cellId(row.participant_id, key),
          message: `${name} · ${stats.find((stat) => stat.key === key)?.name ?? key} : ${t(message)}`,
        })),
        ...(found.rank
          ? [{ fieldId: cellId(row.participant_id, 'rank'), message: `${name} : ${t(found.rank, { max: rows.length })}` }]
          : []),
      ]
    }),
    ...(formError ? [{ message: formDetail ? `${t(formError)} ${formDetail}` : t(formError) }] : []),
  ]

  const errorText = (participantId: string, field: string, message: string | undefined) =>
    message ? (
      <p id={`${cellId(participantId, field)}-error`} className="mt-1 text-xs text-destructive">
        <span className="font-medium">{t('common.error')}</span> {message}
      </p>
    ) : null

  if (match.participants.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('matches.resultsNoParticipants')}</p>
  }

  return (
    <form onSubmit={submit} noValidate aria-busy={busy} className="grid gap-4">
      <ErrorSummary ref={summaryRef} items={items} title={t('matches.validation.fixErrors')} />
      <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <Icon icon={InformationCircleIcon} size={18} className="mt-0.5 shrink-0" />
        <span>
          {t('matches.resultsHint')} {stats.length === 0 ? t('matches.noStats') : null}
        </span>
      </p>
      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full min-w-max text-left text-sm">
          <caption className="sr-only">{t('matches.resultsTitle')}</caption>
          <thead>
            <tr className="border-b bg-muted/60 align-bottom">
              <th scope="col" className="px-3 py-2 font-medium">
                {t('matches.participant')}
              </th>
              {stats.map((stat) => (
                <th key={stat.id} scope="col" className="px-3 py-2 font-medium">
                  <span className="block">{stat.name}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    <code>{stat.key}</code> · {t(statTypeLabelKey(stat.type))}
                    {scored.has(stat.id) ? ` · ${t('matches.scored')}` : ''}
                  </span>
                </th>
              ))}
              <th scope="col" className="px-3 py-2 font-medium">
                {t('matches.rankOptional')}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t('matches.resultOptional')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const who = identity(row.participant_id)
              const found = errors[row.participant_id]
              return (
                <tr key={row.participant_id} className="border-b align-top last:border-0">
                  <th scope="row" className="px-3 py-2 font-medium">
                    <span className="block">{who.name}</span>
                    {who.detail ? <span className="block text-xs font-normal text-muted-foreground">{who.detail}</span> : null}
                  </th>
                  {stats.map((stat) => {
                    const message = found?.stats?.[stat.key]
                    return (
                      <td key={stat.id} className="px-3 py-2">
                        <Input
                          id={cellId(row.participant_id, stat.key)}
                          inputMode="decimal"
                          className="w-28"
                          aria-label={t('matches.statFor', { stat: stat.name, name: who.name })}
                          value={row.stats[stat.key] ?? ''}
                          aria-invalid={message ? true : undefined}
                          aria-describedby={message ? `${cellId(row.participant_id, stat.key)}-error` : undefined}
                          onChange={(event) =>
                            update(row.participant_id, (current) => ({ ...current, stats: { ...current.stats, [stat.key]: event.target.value } }))
                          }
                        />
                        {errorText(row.participant_id, stat.key, message ? t(message) : undefined)}
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
                    {errorText(row.participant_id, 'rank', found?.rank ? t(found.rank, { max: rows.length }) : undefined)}
                  </td>
                  <td className="px-3 py-2">
                    <NativeSelect
                      aria-label={t('matches.resultFor', { name: who.name })}
                      value={row.result}
                      onChange={(event) =>
                        update(row.participant_id, (current) => ({ ...current, result: event.target.value as MatchResult | '' }))
                      }
                    >
                      <option value="">{t('matches.resultAuto')}</option>
                      {MATCH_RESULTS.map((value) => (
                        <option key={value} value={value}>
                          {t(resultLabelKey(value))}
                        </option>
                      ))}
                    </NativeSelect>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {partialRanks(rows) ? <p className="text-sm text-amber-800 dark:text-amber-200">{t('matches.partialRanks')}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          <Icon icon={FloppyDiskIcon} />
          {busy ? t('matches.saving') : t('matches.saveResults')}
        </Button>
      </div>
    </form>
  )
}
