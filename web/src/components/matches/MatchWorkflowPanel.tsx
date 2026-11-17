import {
  historicalScores,
  describeValues,
  type DisplayStat,
} from '@/features/matches/workflow-types'
import { useRef, useState } from 'react'
import {
  Calendar03Icon,
  Attachment01Icon,
  RefreshIcon,
  CheckmarkCircle02Icon,
} from '@hugeicons/core-free-icons'
import { SectionCard } from '@/components/tournaments/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Icon } from '@/components/ui/icon'
import { StateMessage } from '@/components/games/StateMessage'
import { useAsyncResource } from '@/hooks/use-async-resource'
import type { Identity } from '@/hooks/use-participant-identities'
import { useI18n, type MessageKey } from '@/i18n/context'
import { apiRequest, ApiError } from '@/lib/api/client'
import type { Match } from '@/features/matches/types'
import type {
  WorkflowView,
  WorkflowAction,
  WorkflowRequest,
  Report,
  CorrectionPreview,
  CorrectionRequest,
  AttendanceStatus,
} from '@/features/matches/workflow-types'
import { MatchReportEditor } from './MatchReportEditor'

const selectStyle =
  'min-h-10 rounded-lg border border-input bg-background px-3 text-foreground focus-visible:outline-2 focus-visible:outline-ring'
export function MatchWorkflowPanel({
  tournamentId,
  match,
  identity,
  onChanged,
  stats,
}: {
  tournamentId: string
  match: Match
  identity: (id: string) => Identity
  onChanged: () => void
  stats: DisplayStat[]
}) {
  const { t, lang } = useI18n()
  const base = `/tournaments/${tournamentId}/steps/${match.step_id}/matches/${match.id}`
  const resource = useAsyncResource(
    async (signal) => {
      try {
        return await apiRequest<WorkflowView>(base + '/workflow', { signal })
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) return null
        throw error
      }
    },
    [base, match.updated_at],
  )
  const view = resource.state.status === 'success' ? resource.state.data : null
  const [tab, setTab] = useState<
    'reports' | 'schedule' | 'disputes' | 'history'
  >('reports')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState<MessageKey | null>(null)
  const [notice, setNotice] = useState(false)
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState(false)
  const [adminDecision, setAdminDecision] = useState(false)
  const [chosen, setChosen] = useState('')
  const [acceptClaim, setAcceptClaim] = useState(true)
  const [attachments, setAttachments] = useState<
    { id: string; name: string }[]
  >([])
  const pending = useRef<{ key: string; request: WorkflowRequest } | null>(null)
  const correction = useRef<CorrectionRequest | null>(null)
  const [preview, setPreview] = useState<{
    impact: CorrectionPreview
    report: Report
    reason: string
  } | null>(null)
  const [ack, setAck] = useState(false)
  async function run(operation: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    setNotice(false)
    try {
      await operation()
    } catch (error) {
      setError(
        error instanceof ApiError && error.status === 409
          ? 'matches.errors.conflict'
          : error instanceof ApiError && error.status === 400
            ? 'matchWorkflow.invalid'
            : 'matchWorkflow.retryHint',
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  function changed() {
    setNotice(true)
    resource.reload()
    onChanged()
  }
  async function send(action: WorkflowAction) {
    if (!view) return
    const key = JSON.stringify(action)
    if (pending.current?.key !== key)
      pending.current = {
        key,
        request: {
          operation_id: crypto.randomUUID(),
          revision: view.workflow.revision,
          action,
        },
      }
    const request = pending.current.request
    await run(async () => {
      try {
        await apiRequest(base + '/workflow', { method: 'POST', body: request })
        pending.current = null
        setEditing(false)
        setReason('')
        setAttachments([])
        changed()
      } catch (error) {
        if (error instanceof ApiError && error.status < 500) {
          pending.current = null
          resource.reload()
        }
        throw error
      }
    })
  }
  function submit(report: Report) {
    if (match.status === 'finished') {
      void run(async () => {
        const impact = await apiRequest<CorrectionPreview>(
          base + '/correction-preview',
          { method: 'POST', body: { report, reason } },
        )
        setPreview({ impact, report, reason })
        setAck(false)
        correction.current = null
      })
    } else
      void send(
        adminDecision
          ? { kind: 'adjudicate', report, reason }
          : { kind: 'submit', report },
      )
  }
  async function upload(file: File) {
    await run(async () => {
      if (
        !['image/png', 'image/jpeg', 'application/pdf'].includes(file.type) ||
        file.size === 0 ||
        file.size > 5 * 1024 * 1024
      ) {
        setError('matchWorkflow.invalidFile')
        return
      }
      const id = crypto.randomUUID()
      await apiRequest(base + '/evidence/' + id, {
        method: 'PUT',
        rawBody: file,
        contentType: file.type,
      })
      setAttachments((old) => [...old, { id, name: file.name }])
    })
  }
  async function download(id: string) {
    await run(async () => {
      const response = await apiRequest<Response>(base + '/evidence/' + id, {
        responseType: 'response',
      })
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `evidence.${blob.type.includes('pdf') ? 'pdf' : blob.type.includes('png') ? 'png' : 'jpg'}`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    })
  }
  if (resource.state.status === 'success' && !view) return null
  if (!view)
    return (
      <StateMessage
        kind={resource.state.status === 'error' ? 'error' : 'loading'}
        action={
          <Button variant="outline" onClick={resource.reload}>
            {t('common.retry')}
          </Button>
        }
      >
        {t('matchWorkflow.title')}
      </StateMessage>
    )
  const workflow = view.workflow
  const open = ['scheduled', 'ongoing'].includes(match.status)
  return (
    <SectionCard
      id="match-workflow"
      title={t('matchWorkflow.title')}
      icon={CheckmarkCircle02Icon}
    >
      <nav
        className="flex flex-wrap gap-2"
        aria-label={t('matchWorkflow.title')}
      >
        {(['reports', 'schedule', 'disputes', 'history'] as const).map(
          (value) => (
            <Button
              key={value}
              variant={value === tab ? 'default' : 'outline'}
              aria-pressed={value === tab}
              onClick={() => setTab(value)}
            >
              {t(`matchWorkflow.${value}`)}
            </Button>
          ),
        )}
        <Button variant="outline" disabled={busy} onClick={resource.reload}>
          <Icon icon={RefreshIcon} />
          {t('matches.refreshMatch')}
        </Button>
      </nav>
      {error ? (
        <p role="alert" className="text-destructive">
          {t(error)}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-primary">
          {t('matchWorkflow.saved')}
        </p>
      ) : null}
      {tab === 'schedule' ? (
        <SchedulePanel
          key={workflow.revision}
          view={view}
          match={match}
          identity={identity}
          busy={busy}
          onAction={(action) => void send(action)}
          onRound={(body) =>
            void run(async () => {
              await apiRequest(
                `/tournaments/${tournamentId}/steps/${match.step_id}/rounds/${match.round}/schedule`,
                { method: 'POST', body },
              )
              changed()
            })
          }
        />
      ) : null}
      {tab === 'reports' ? (
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            {t('matchWorkflow.independent')}
          </p>
          {!workflow.submissions.length ? (
            <p>{t('matchWorkflow.emptyReports')}</p>
          ) : null}
          {workflow.submissions.map((submission, index) => (
            <article
              key={submission.id}
              className="grid gap-3 rounded-xl border p-4"
            >
              <h3 className="font-semibold">
                {t('matchWorkflow.reportNumber')} {index + 1} ·{' '}
                {identity(submission.participant_id).name}
              </h3>
              <p className="font-medium text-primary">
                {t(`matchWorkflow.${submission.status}`)}
              </p>
              <p>
                {t('matchWorkflow.confirmations')} :{' '}
                {Object.keys(submission.confirmations).length}/
                {match.participants.length}
              </p>
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  {t('matchWorkflow.reports')}
                </caption>
                <thead>
                  <tr>
                    <th>{t('matches.participant')}</th>
                    <th>{t('matchWorkflow.rank')}</th>
                    <th>{t('matchWorkflow.wins')}</th>
                  </tr>
                </thead>
                <tbody>
                  {submission.results.map((score) => (
                    <tr key={score.participant_id}>
                      <th className="py-2 font-medium">
                        {identity(score.participant_id).name}
                      </th>
                      <td>{score.rank ?? '—'}</td>
                      <td>{score.games_won ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {submission.games.map((game, index) => (
                <details key={index} className="rounded-lg border p-3">
                  <summary className="cursor-pointer font-medium">
                    {t('matchWorkflow.game')} {index + 1}
                  </summary>
                  <div className="mt-3 grid gap-2">
                    {describeValues(
                      game.attributes,
                      stats,
                      view.identities ?? {},
                    ).map((line, i) => (
                      <p key={i}>
                        {line.label} : {line.value}
                      </p>
                    ))}
                    {game.results.map((score) => (
                      <div key={score.participant_id} className="grid gap-1">
                        <h4 className="font-medium">
                          {identity(score.participant_id).name} ·{' '}
                          {t('matchWorkflow.rank')} {score.rank ?? '—'}
                        </h4>
                        {describeValues(
                          score.stats,
                          stats,
                          view.identities ?? {},
                        ).map((line, i) => (
                          <p key={i}>
                            {line.label} : {line.value}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                </details>
              ))}
              <div className="flex flex-wrap gap-2">
                {open &&
                view.participant_id &&
                submission.status === 'pending' &&
                !submission.confirmations[view.participant_id] ? (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void send({
                        kind: 'confirm',
                        submission_id: submission.id,
                      })
                    }
                  >
                    {t('matchWorkflow.confirm')}
                  </Button>
                ) : null}
                {(open || match.status === 'finished') &&
                view.participant_id ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setChosen(submission.id)
                      setTab('disputes')
                    }}
                  >
                    {t('matchWorkflow.dispute')}
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
          {open && view.participant_id ? (
            <Button
              onClick={() => {
                setAdminDecision(false)
                setEditing(!editing || adminDecision)
                setPreview(null)
              }}
            >
              {t('matchWorkflow.submit')}
            </Button>
          ) : null}
          {view.can_manage && (open || match.status === 'finished') ? (
            <Button
              variant={view.participant_id && open ? 'outline' : 'default'}
              onClick={() => {
                setAdminDecision(true)
                setEditing(!editing || !adminDecision)
                setPreview(null)
              }}
            >
              {t(
                match.status === 'finished'
                  ? 'matchWorkflow.correct'
                  : 'matchWorkflow.adjudicate',
              )}
            </Button>
          ) : null}
          {editing ? (
            <>
              {adminDecision ? (
                <label className="grid gap-2">
                  {t('matchWorkflow.reason')}
                  <textarea
                    className={selectStyle}
                    maxLength={2000}
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value)
                      setPreview(null)
                    }}
                  />
                </label>
              ) : null}
              <MatchReportEditor
                match={match}
                identity={identity}
                busy={busy || (adminDecision && !reason.trim())}
                label={t(
                  match.status === 'finished'
                    ? 'matchWorkflow.preview'
                    : adminDecision
                      ? 'matchWorkflow.adjudicate'
                      : 'matchWorkflow.submit',
                )}
                onChange={() => setPreview(null)}
                onSubmit={submit}
              />
            </>
          ) : null}
          {preview ? (
            <aside className="grid gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <h3 className="font-semibold">{t('matchWorkflow.impact')}</h3>
              <p>
                {t(
                  preview.impact.requires_resolution
                    ? 'matchWorkflow.impactHint'
                    : 'matchWorkflow.noImpact',
                )}
              </p>
              <ul>
                {preview.impact.affected.map((m) => (
                  <li key={m.match_id}>
                    {t('matchWorkflow.impactMatch', {
                      step: m.step_position ?? '—',
                      round: m.round ?? '—',
                      number: m.number ?? '—',
                      group: m.group_index ?? '—',
                    })}{' '}
                    ·{' '}
                    {m.bracket
                      ? t(`matches.bracket.${m.bracket}` as MessageKey)
                      : ''}{' '}
                    {t(
                      m.archived
                        ? 'matchWorkflow.archived'
                        : 'matchWorkflow.reset',
                    )}
                  </li>
                ))}
              </ul>
              {preview.impact.requires_resolution ? (
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                  />
                  {t('matchWorkflow.acknowledge')}
                </label>
              ) : null}
              <Button
                disabled={busy || (preview.impact.requires_resolution && !ack)}
                onClick={() =>
                  void run(async () => {
                    correction.current ??= {
                      operation_id: crypto.randomUUID(),
                      revision: preview.impact.revision,
                      report: preview.report,
                      reason: preview.reason,
                      reset_downstream: ack,
                    }
                    await apiRequest(base + '/corrections', {
                      method: 'POST',
                      body: correction.current,
                    })
                    correction.current = null
                    setPreview(null)
                    setEditing(false)
                    changed()
                  })
                }
              >
                {t('matchWorkflow.applyCorrection')}
              </Button>
            </aside>
          ) : null}
        </div>
      ) : null}
      {tab === 'disputes' ? (
        <div className="grid gap-4">
          {!workflow.disputes.length ? (
            <p>{t('matchWorkflow.emptyDisputes')}</p>
          ) : null}
          {workflow.disputes.map((dispute) => (
            <article
              key={dispute.id}
              className="grid gap-3 rounded-xl border p-4"
            >
              <p className="whitespace-pre-wrap">{dispute.reason}</p>
              <div className="flex flex-wrap gap-2">
                {dispute.evidence.map((id, i) => (
                  <Button
                    key={id}
                    variant="outline"
                    disabled={busy}
                    onClick={() => void download(id)}
                  >
                    <Icon icon={Attachment01Icon} />
                    {t('matchWorkflow.attachment')} {i + 1}
                  </Button>
                ))}
              </div>
              {dispute.decision ? (
                <>
                  <h3 className="font-semibold">
                    {t('matchWorkflow.resolution')}
                  </h3>
                  <p>{dispute.decision.reason}</p>
                </>
              ) : view.can_manage && open ? (
                <>
                  <label className="grid gap-2">
                    {t('matchWorkflow.resolution')}
                    <select
                      className={selectStyle}
                      value={acceptClaim ? 'acceptClaim' : 'rejectClaim'}
                      onChange={(e) =>
                        setAcceptClaim(e.target.value === 'acceptClaim')
                      }
                    >
                      <option value="acceptClaim">
                        {t('matchWorkflow.acceptClaim')}
                      </option>
                      <option value="rejectClaim">
                        {t('matchWorkflow.rejectClaim')}
                      </option>
                    </select>
                  </label>
                  {!workflow.submissions.length ? (
                    <Button
                      onClick={() => {
                        setTab('reports')
                        setAdminDecision(true)
                        setEditing(true)
                      }}
                    >
                      {t('matchWorkflow.adjudicate')}
                    </Button>
                  ) : null}
                  <label className="grid gap-2">
                    {t('matchWorkflow.chosenReport')}
                    <select
                      className={selectStyle}
                      value={chosen}
                      onChange={(e) => setChosen(e.target.value)}
                    >
                      <option value="">—</option>
                      {workflow.submissions
                        .filter((s) => s.status !== 'rejected')
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {t('matchWorkflow.reportNumber')}{' '}
                            {workflow.submissions.indexOf(s) + 1} ·{' '}
                            {identity(s.participant_id).name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="grid gap-2">
                    {t('matchWorkflow.reason')}
                    <textarea
                      className={selectStyle}
                      value={reason}
                      maxLength={2000}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <Button
                    disabled={busy || !chosen || !reason.trim()}
                    onClick={() =>
                      void send({
                        kind: 'resolve',
                        dispute_id: dispute.id,
                        submission_id: chosen,
                        accepted: acceptClaim,
                        reason,
                      })
                    }
                  >
                    {t('matchWorkflow.resolve')}
                  </Button>
                </>
              ) : (
                <p>{t('matchWorkflow.disputed')}</p>
              )}
            </article>
          ))}
          {(open || match.status === 'finished') && view.participant_id ? (
            <div className="grid gap-3">
              <label className="grid gap-2">
                {t('matchWorkflow.reason')}
                <textarea
                  className={selectStyle}
                  value={reason}
                  maxLength={2000}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label className="grid gap-2">
                {t('matchWorkflow.attach')}
                <Input
                  type="file"
                  accept="image/png,image/jpeg,application/pdf"
                  disabled={busy || attachments.length >= 5}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void upload(file)
                    e.target.value = ''
                  }}
                />
              </label>
              <p className="text-sm text-muted-foreground">
                {t('matchWorkflow.attachmentHint')}
              </p>
              {attachments.map((a) => (
                <Button
                  key={a.id}
                  variant="outline"
                  onClick={() =>
                    setAttachments(
                      attachments.filter((item) => item.id !== a.id),
                    )
                  }
                >
                  {a.name} ×
                </Button>
              ))}
              <Button
                disabled={busy || !reason.trim()}
                onClick={() =>
                  void send({
                    kind: 'dispute',
                    submission_id: chosen || null,
                    reason,
                    evidence: attachments.map((a) => a.id),
                  })
                }
              >
                {t('matchWorkflow.dispute')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {tab === 'history' ? (
        <ol className="grid gap-3">
          {!workflow.history.length ? (
            <li>{t('matchWorkflow.emptyHistory')}</li>
          ) : null}
          {[...workflow.history].reverse().map((entry) => (
            <li key={entry.id} className="grid gap-1 rounded-xl border p-4">
              <h3 className="font-semibold">
                {t(
                  ('matchWorkflow.events.' +
                    entry.action.replace('match.', '')) as MessageKey,
                )}
              </h3>
              <time
                className="text-sm text-muted-foreground"
                dateTime={entry.created_at}
              >
                {new Date(entry.created_at).toLocaleString(lang)}
              </time>
              <p>
                {view.identities?.[entry.actor_id] ?? t('teams.unknownUser')}
              </p>
              {entry.reason ? <p>{entry.reason}</p> : null}
              {entry.action === 'match.corrected' ? (
                <>
                  <h4 className="font-medium">
                    {t('matchWorkflow.previousResults')}
                  </h4>
                  {historicalScores(entry.before).map((score) => (
                    <p key={score.participant_id}>
                      {identity(score.participant_id).name} ·{' '}
                      {score.rank ?? '—'}
                      {score.games_won != null
                        ? ` · ${score.games_won} ${t('matchWorkflow.wins')}`
                        : ''}
                    </p>
                  ))}
                </>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </SectionCard>
  )
}

function SchedulePanel({
  view,
  match,
  identity,
  busy,
  onAction,
  onRound,
}: {
  view: WorkflowView
  match: Match
  identity: (id: string) => Identity
  busy: boolean
  onAction: (a: WorkflowAction) => void
  onRound: (body: Record<string, unknown>) => void
}) {
  const { t, lang } = useI18n()
  const schedule = view.workflow.schedule
  const roundOperation = useRef({ key: '', id: crypto.randomUUID() })
  const localDate = (value: string | null) => {
    if (!value) return ''
    const date = new Date(value)
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
    return date.toISOString().slice(0, 16)
  }
  const [date, setDate] = useState(localDate(schedule.scheduled_at))
  const [duration, setDuration] = useState(
    schedule.duration_minutes?.toString() ?? '',
  )
  const [venue, setVenue] = useState(schedule.venue ?? '')
  const [station, setStation] = useState(schedule.station ?? '')
  const [minutes, setMinutes] = useState('')
  const [reason, setReason] = useState('')
  const admin =
    view.can_manage && ['scheduled', 'ongoing'].includes(match.status)
  const valid = (v: string) =>
    /^\d+$/.test(v) && Number(v) > 0 && Number(v) <= 1440
  return (
    <div className="grid gap-4">
      <h3 className="flex items-center gap-2 font-semibold">
        <Icon icon={Calendar03Icon} />
        {t('matchWorkflow.schedule')}
      </h3>
      {admin ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-2">
              {t('matchWorkflow.date')}
              <Input
                type="datetime-local"
                value={date}
                disabled={busy || match.status !== 'scheduled'}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            {(
              [
                ['duration', duration, setDuration],
                ['venue', venue, setVenue],
                ['station', station, setStation],
              ] as const
            ).map(([key, value, set]) => (
              <label key={key} className="grid gap-2">
                {t(`matchWorkflow.${key}`)}
                <Input
                  value={value}
                  disabled={busy || match.status !== 'scheduled'}
                  onChange={(e) => set(e.target.value)}
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                busy ||
                match.status !== 'scheduled' ||
                (!!duration && !valid(duration))
              }
              onClick={() =>
                onAction({
                  kind: 'schedule',
                  scheduled_at: date ? new Date(date).toISOString() : null,
                  duration_minutes: duration ? Number(duration) : null,
                  venue: venue.trim() || null,
                  station: station.trim() || null,
                })
              }
            >
              {t('common.save')}
            </Button>
            {match.round && match.status === 'scheduled' ? (
              <Button
                variant="outline"
                disabled={busy || (!!duration && !valid(duration))}
                onClick={() => {
                  const body = {
                    scheduled_at: date ? new Date(date).toISOString() : null,
                    duration_minutes: duration ? Number(duration) : null,
                    venue: venue.trim() || null,
                    station: station.trim() || null,
                  }
                  const key = JSON.stringify(body)
                  if (roundOperation.current.key !== key)
                    roundOperation.current = { key, id: crypto.randomUUID() }
                  onRound({ ...body, operation_id: roundOperation.current.id })
                }}
              >
                {t('matchWorkflow.roundDefaults')}
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onAction({ kind: 'call' })}
            >
              {t('matchWorkflow.call')}
            </Button>
          </div>
          <label className="grid gap-2">
            {t('matchWorkflow.reason')}
            <textarea
              className={selectStyle}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="grid gap-2">
            {t('matchWorkflow.minutes')}
            <Input
              type="number"
              min={1}
              max={1440}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <Button
            variant="outline"
            disabled={busy || !valid(minutes) || !reason.trim()}
            onClick={() =>
              onAction({ kind: 'delay', minutes: Number(minutes), reason })
            }
          >
            {t('matchWorkflow.delay')}
          </Button>
        </>
      ) : (
        <p>
          {schedule.scheduled_at
            ? new Date(schedule.scheduled_at).toLocaleString(lang)
            : t('matches.notScheduled')}{' '}
          · {schedule.venue} {schedule.station}
        </p>
      )}
      {schedule.called_at ? (
        <p className="text-primary">{t('matchWorkflow.called')}</p>
      ) : null}
      {schedule.delay_minutes > 0 ? (
        <p>
          {t('matchWorkflow.minutes')} : {schedule.delay_minutes}
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {match.participants.map((p) => (
          <label
            key={p.participant_id}
            className="grid gap-2 rounded-xl border p-3"
          >
            {identity(p.participant_id).name}
            {admin ? (
              <select
                className={selectStyle}
                disabled={busy}
                value={
                  view.workflow.attendance[p.participant_id]?.status ??
                  'expected'
                }
                onChange={(e) => {
                  const status = e.target.value as AttendanceStatus
                  if (
                    status === 'forfeit' &&
                    !window.confirm(t('matchWorkflow.forfeitWarning'))
                  )
                    return
                  onAction({
                    kind: 'attendance',
                    participant_id: p.participant_id,
                    status,
                    reason: reason.trim() || null,
                  })
                }}
              >
                {(
                  ['expected', 'present', 'late', 'absent', 'forfeit'] as const
                ).map((status) => (
                  <option
                    key={status}
                    value={status}
                    disabled={
                      ['absent', 'forfeit'].includes(status) && !reason.trim()
                    }
                  >
                    {t(`matchWorkflow.${status}`)}
                  </option>
                ))}
              </select>
            ) : (
              <span>
                {t(
                  `matchWorkflow.${view.workflow.attendance[p.participant_id]?.status ?? 'expected'}`,
                )}
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  )
}
