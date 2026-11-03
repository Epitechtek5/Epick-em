import { Add01Icon, Delete02Icon, Edit02Icon } from '@hugeicons/core-free-icons'
import { useId, useState, type FormEvent } from 'react'

import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { StateMessage } from '@/components/games/StateMessage'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { listGameStats } from '@/features/stats/api'
import type { Stat } from '@/features/stats/types'
import {
  createScoringRule,
  deleteScoringRule,
  listScoringRules,
  updateScoringRule,
} from '@/features/tournaments/api'
import { tournamentErrorKey } from '@/features/tournaments/errors'
import { formatPoints } from '@/features/tournaments/format'
import { scoringModeLabelKey } from '@/features/tournaments/labels'
import { scoringEditable } from '@/features/tournaments/lifecycle'
import {
  SCORING_MODES,
  type ScoringMode,
  type ScoringRule,
  type ScoringRuleDefinition,
  type Tournament,
} from '@/features/tournaments/types'
import { buildScoringDefinition, pointsRows, type PointsRow } from '@/features/tournaments/validation'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useI18n, type MessageKey, type Params } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

interface Feedback {
  kind: 'success' | 'error'
  key: MessageKey
  params?: Params
}

// Barème du tournoi (GET /tournaments/{id}/scoring-rules), une règle par statistique. Les
// administrateurs ajoutent, modifient et retirent des règles tant que le tournoi est en
// brouillon ou en inscription ; seules les statistiques liées au jeu du tournoi sont proposées.
export function ScoringRulesSection({ tournament }: { tournament: Tournament }) {
  const { t } = useI18n()
  const { isAdmin, refreshRole } = useAuth()
  const { state, reload } = useAsyncResource((signal) => listScoringRules(tournament.id, signal), [tournament.id])
  const statsState = useAsyncResource((signal) => listGameStats(tournament.game_id, signal), [tournament.game_id])
  const stats = statsState.state.status === 'success' ? statsState.state.data : []
  const statMap = new Map(stats.map((stat) => [stat.id, stat]))
  const rules = state.status === 'success' ? state.data : []
  const editable = isAdmin && scoringEditable(tournament.status)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const statLabel = (statId: string) => {
    const stat = statMap.get(statId)
    return stat ? `${stat.name} (${stat.key})` : t('tournaments.scoring.unknownStat')
  }

  async function mutate(target: string, run: () => Promise<unknown>, success: Feedback): Promise<boolean> {
    setBusy(target)
    setFeedback(null)
    try {
      await run()
      setFeedback(success)
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      setFeedback({ kind: 'error', key: tournamentErrorKey(error) })
      return false
    } finally {
      setBusy(null)
      reload()
    }
  }

  return (
    <section aria-labelledby="scoring-title" className="grid gap-3">
      <h2 id="scoring-title" className="text-lg font-semibold">
        {t('tournaments.scoring.title')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('tournaments.scoring.hint')}</p>
      {isAdmin && !editable ? (
        <p className="rounded-lg border border-border p-3 text-sm">{t('tournaments.scoring.locked')}</p>
      ) : null}

      {feedback ? <StateMessage kind={feedback.kind}>{t(feedback.key, feedback.params)}</StateMessage> : null}

      {state.status === 'loading' ? <StateMessage kind="loading">{t('tournaments.scoring.loading')}</StateMessage> : null}
      {state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(tournamentErrorKey(state.error))}
        </StateMessage>
      ) : null}
      {state.status === 'success' && rules.length === 0 ? (
        <StateMessage kind="empty">{t('tournaments.scoring.empty')}</StateMessage>
      ) : null}

      {rules.length > 0 ? (
        <ul aria-label={t('tournaments.scoring.list')} className="grid gap-2">
          {rules.map((rule) => {
            const label = statLabel(rule.stat_id)
            return (
              <li key={rule.id} className="grid gap-2 rounded-lg px-3 py-2 ring-1 ring-foreground/10">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="grid min-w-0">
                    <span className="font-medium break-words">{label}</span>
                    <RuleSummary rule={rule} />
                  </div>
                  {editable ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        aria-expanded={editing === rule.id}
                        aria-label={t('tournaments.scoring.editFor', { name: label })}
                        onClick={() => setEditing(editing === rule.id ? null : rule.id)}
                      >
                        <Icon icon={Edit02Icon} />
                        {t('tournaments.scoring.edit')}
                      </Button>
                      <ConfirmDeleteDialog
                        size="sm"
                        label={t('tournaments.scoring.delete')}
                        busyLabel={t('tournaments.scoring.working')}
                        triggerAriaLabel={t('tournaments.scoring.deleteFor', { name: label })}
                        title={t('tournaments.scoring.confirmDeleteTitle')}
                        description={t('tournaments.scoring.confirmDelete', { name: label })}
                        busy={busy === rule.id}
                        onConfirm={() =>
                          void mutate(rule.id, () => deleteScoringRule(tournament.id, rule.id), {
                            kind: 'success',
                            key: 'tournaments.scoring.deleted',
                            params: { name: label },
                          })
                        }
                      />
                    </div>
                  ) : null}
                </div>
                {editable && editing === rule.id ? (
                  <RuleEditor
                    idPrefix={`rule-${rule.id}`}
                    initialMode={rule.mode}
                    initialCoefficient={rule.coefficient === null ? '' : String(rule.coefficient)}
                    initialRows={pointsRows(rule.points_table)}
                    submitLabel={t('common.save')}
                    busy={busy === rule.id}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (definition) => {
                      const ok = await mutate(rule.id, () => updateScoringRule(tournament.id, rule.id, definition), {
                        kind: 'success',
                        key: 'tournaments.scoring.updated',
                        params: { name: label },
                      })
                      if (ok) setEditing(null)
                    }}
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      {editable && state.status === 'success' ? (
        <AddRuleForm
          stats={stats}
          statsState={statsState.state.status}
          onRetryStats={statsState.reload}
          takenIds={rules.map((rule) => rule.stat_id)}
          busy={busy === 'add'}
          disabled={busy !== null}
          onAdd={(stat, definition) =>
            mutate('add', () => createScoringRule(tournament.id, stat.id, definition), {
              kind: 'success',
              key: 'tournaments.scoring.added',
              params: { name: `${stat.name} (${stat.key})` },
            })
          }
        />
      ) : null}
    </section>
  )
}

function RuleSummary({ rule }: { rule: ScoringRule }) {
  const { t, lang } = useI18n()
  if (rule.mode === 'linear') {
    return (
      <span className="text-sm text-muted-foreground">
        {t(scoringModeLabelKey('linear'))} : {t('tournaments.scoring.linearSummary', { coefficient: formatPoints(lang, rule.coefficient ?? 0) })}
      </span>
    )
  }
  const rows = pointsRows(rule.points_table)
  return (
    <div className="grid gap-1 text-sm text-muted-foreground">
      <span>{t(scoringModeLabelKey('table'))} :</span>
      <table className="w-fit text-left">
        <caption className="sr-only">{t('tournaments.scoring.tableCaption')}</caption>
        <thead>
          <tr>
            <th scope="col" className="pr-4 font-medium">{t('tournaments.scoring.value')}</th>
            <th scope="col" className="font-medium">{t('tournaments.scoring.points')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.value}>
              <td className="pr-4 font-mono">{row.value}</td>
              <td className="font-mono">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AddRuleForm({
  stats,
  statsState,
  onRetryStats,
  takenIds,
  busy,
  disabled,
  onAdd,
}: {
  stats: Stat[]
  statsState: 'loading' | 'success' | 'error'
  onRetryStats: () => void
  takenIds: string[]
  busy: boolean
  disabled: boolean
  onAdd: (stat: Stat, definition: ScoringRuleDefinition) => Promise<boolean>
}) {
  const { t } = useI18n()
  const [statId, setStatId] = useState('')
  const [statError, setStatError] = useState(false)
  const [version, setVersion] = useState(0)
  const available = stats.filter((stat) => !takenIds.includes(stat.id))
  const stat = available.find((candidate) => candidate.id === statId)

  if (statsState === 'loading') return <StateMessage kind="loading">{t('tournaments.scoring.loadingStats')}</StateMessage>
  if (statsState === 'error') {
    return (
      <StateMessage
        kind="error"
        action={
          <Button variant="outline" size="sm" onClick={onRetryStats}>
            {t('common.retry')}
          </Button>
        }
      >
        {t('tournaments.scoring.errors.statsUnavailable')}
      </StateMessage>
    )
  }
  if (available.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {stats.length === 0 ? t('tournaments.scoring.noLinkedStats') : t('tournaments.scoring.allStatsUsed')}
      </p>
    )
  }

  return (
    <div className="grid gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
      <h3 className="text-base font-semibold">{t('tournaments.scoring.add')}</h3>
      <div className="grid gap-1 sm:max-w-sm">
        <Label htmlFor="rule-stat">{t('tournaments.scoring.stat')}</Label>
        <SearchableSelect
          id="rule-stat"
          options={available.map((candidate) => ({ value: candidate.id, label: candidate.name, hint: candidate.key }))}
          value={statId}
          onChange={(value) => {
            setStatId(value)
            setStatError(false)
          }}
          placeholder={t('tournaments.scoring.chooseStat')}
          noResultsLabel={t('common.noResults')}
          required
          aria-invalid={statError || undefined}
          aria-describedby={['rule-stat-hint', statError ? 'rule-stat-error' : ''].filter(Boolean).join(' ')}
        />
        <p id="rule-stat-hint" className="text-sm text-muted-foreground">
          {t('tournaments.scoring.statHint')}
        </p>
        {statError ? (
          <p id="rule-stat-error" className="text-sm text-destructive">
            <span className="font-medium">{t('common.error')}</span> {t('tournaments.scoring.validation.stat')}
          </p>
        ) : null}
      </div>
      <RuleEditor
        key={version}
        idPrefix="rule-new"
        initialMode="linear"
        initialCoefficient=""
        initialRows={[{ value: '', points: '' }]}
        submitLabel={t('tournaments.scoring.addButton')}
        submitIcon
        busy={busy}
        disabled={disabled}
        precheck={() => {
          if (stat) return true
          setStatError(true)
          document.getElementById('rule-stat')?.focus()
          return false
        }}
        onSubmit={async (definition) => {
          if (!stat) return
          if (await onAdd(stat, definition)) {
            setStatId('')
            setVersion((v) => v + 1)
          }
        }}
      />
    </div>
  )
}

// Saisie d'un barème : `linear` (coefficient) ou `table` (valeur → points, lignes ajoutables).
function RuleEditor({
  idPrefix,
  initialMode,
  initialCoefficient,
  initialRows,
  submitLabel,
  submitIcon,
  busy,
  disabled,
  onSubmit,
  onCancel,
  precheck,
}: {
  idPrefix: string
  initialMode: ScoringMode
  initialCoefficient: string
  initialRows: PointsRow[]
  submitLabel: string
  submitIcon?: boolean
  busy: boolean
  disabled?: boolean
  onSubmit: (definition: ScoringRuleDefinition) => void | Promise<void>
  onCancel?: () => void
  // Contrôle préalable (ex. statistique choisie) ; false arrête la soumission.
  precheck?: () => boolean
}) {
  const { t } = useI18n()
  const errorId = useId()
  const [mode, setMode] = useState<ScoringMode>(initialMode)
  const [coefficient, setCoefficient] = useState(initialCoefficient)
  const [rows, setRows] = useState<PointsRow[]>(initialRows.length > 0 ? initialRows : [{ value: '', points: '' }])
  const [error, setError] = useState<MessageKey | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || disabled) return
    if (precheck && !precheck()) return
    const result = buildScoringDefinition(mode, coefficient, rows)
    if (typeof result === 'string') {
      setError(result)
      return
    }
    setError(null)
    void onSubmit(result)
  }

  const setRow = (index: number, patch: Partial<PointsRow>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  return (
    <form onSubmit={submit} noValidate className="grid gap-3" aria-busy={busy}>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t('tournaments.scoring.modeLabel')}</legend>
        <div className="flex flex-wrap gap-4">
          {SCORING_MODES.map((value) => (
            <label key={value} className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${idPrefix}-mode`}
                value={value}
                checked={mode === value}
                onChange={() => {
                  setMode(value)
                  setError(null)
                }}
                className="size-4 accent-primary"
              />
              {t(scoringModeLabelKey(value))}
            </label>
          ))}
        </div>
      </fieldset>

      {mode === 'linear' ? (
        <div className="grid gap-1 sm:max-w-xs">
          <Label htmlFor={`${idPrefix}-coefficient`}>{t('tournaments.scoring.coefficient')}</Label>
          <Input
            id={`${idPrefix}-coefficient`}
            inputMode="decimal"
            value={coefficient}
            aria-invalid={error ? true : undefined}
            aria-describedby={[`${idPrefix}-coefficient-hint`, error ? errorId : ''].filter(Boolean).join(' ')}
            onChange={(event) => setCoefficient(event.target.value)}
          />
          <p id={`${idPrefix}-coefficient-hint`} className="text-sm text-muted-foreground">
            {t('tournaments.scoring.coefficientHint')}
          </p>
        </div>
      ) : (
        <fieldset className="grid gap-2" aria-describedby={[`${idPrefix}-table-hint`, error ? errorId : ''].filter(Boolean).join(' ')}>
          <legend className="text-sm font-medium">{t('tournaments.scoring.tableLabel')}</legend>
          <p id={`${idPrefix}-table-hint`} className="text-sm text-muted-foreground">
            {t('tournaments.scoring.tableHint')}
          </p>
          {rows.map((row, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1">
                <Label htmlFor={`${idPrefix}-value-${index}`} className="text-xs">
                  {t('tournaments.scoring.valueN', { n: index + 1 })}
                </Label>
                <Input
                  id={`${idPrefix}-value-${index}`}
                  inputMode="decimal"
                  className="w-28"
                  value={row.value}
                  aria-invalid={error ? true : undefined}
                  onChange={(event) => setRow(index, { value: event.target.value })}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${idPrefix}-points-${index}`} className="text-xs">
                  {t('tournaments.scoring.pointsN', { n: index + 1 })}
                </Label>
                <Input
                  id={`${idPrefix}-points-${index}`}
                  inputMode="decimal"
                  className="w-28"
                  value={row.points}
                  aria-invalid={error ? true : undefined}
                  onChange={(event) => setRow(index, { points: event.target.value })}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={rows.length <= 1}
                aria-label={t('tournaments.scoring.removeRow', { n: index + 1 })}
                onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
              >
                <Icon icon={Delete02Icon} />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRows((current) => [...current, { value: '', points: '' }])}
            >
              <Icon icon={Add01Icon} />
              {t('tournaments.scoring.addRow')}
            </Button>
          </div>
        </fieldset>
      )}

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          <span className="font-medium">{t('common.error')}</span> {t(error)}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || disabled}>
          {submitIcon ? <Icon icon={Add01Icon} /> : null}
          {busy ? t('tournaments.scoring.working') : submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  )
}
