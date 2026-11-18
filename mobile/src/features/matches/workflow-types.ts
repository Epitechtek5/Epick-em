export type AttendanceStatus =
  'expected' | 'present' | 'late' | 'absent' | 'forfeit';
export type ReportScore = {
  participant_id: string;
  stats: Record<string, unknown>;
  rank?: number | null;
  result?: 'win' | 'loss' | 'draw' | null;
  games_won?: number | null;
};
export type ReportGame = {
  attributes: Record<string, string | number>;
  results: ReportScore[];
};
export type Report = { results?: ReportScore[]; games?: ReportGame[] };
export type Schedule = {
  scheduled_at: string | null;
  duration_minutes: number | null;
  venue: string | null;
  station: string | null;
  called_at: string | null;
  delay_minutes: number;
};
export type Submission = {
  id: string;
  actor_id: string;
  participant_id: string;
  status: 'pending' | 'disputed' | 'accepted' | 'rejected';
  results: ReportScore[];
  games: ReportGame[];
  confirmations: Record<string, string>;
  created_at: string;
};
export type Dispute = {
  id: string;
  submission_id: string | null;
  actor_id: string;
  reason: string;
  evidence: string[];
  created_at: string;
  decision: {
    actor_id: string;
    reason: string;
    accepted: boolean;
    decided_at: string;
  } | null;
};
export type AuditEntry = {
  id: string;
  actor_id: string;
  action: string;
  reason: string | null;
  created_at: string;
  before: unknown;
  after: unknown;
};
export type Workflow = {
  revision: number;
  schedule: Schedule;
  attendance: Record<
    string,
    { status: AttendanceStatus; reason: string | null }
  >;
  submissions: Submission[];
  disputes: Dispute[];
  history: AuditEntry[];
};
export type WorkflowView = {
  identities?: Record<string, string>;
  workflow: Workflow;
  participant_id: string | null;
  can_manage: boolean;
};
export type WorkflowAction =
  | {
      kind: 'schedule';
      scheduled_at: string | null;
      duration_minutes: number | null;
      venue: string | null;
      station: string | null;
    }
  | { kind: 'call' }
  | { kind: 'delay'; minutes: number; reason: string }
  | {
      kind: 'attendance';
      participant_id: string;
      status: AttendanceStatus;
      reason: string | null;
    }
  | { kind: 'submit'; report: Report }
  | { kind: 'confirm'; submission_id: string }
  | {
      kind: 'dispute';
      submission_id: string | null;
      reason: string;
      evidence: string[];
    }
  | {
      kind: 'resolve';
      dispute_id: string;
      submission_id: string;
      accepted: boolean;
      reason: string;
    }
  | { kind: 'adjudicate'; report: Report; reason: string };
export type WorkflowRequest = {
  operation_id: string;
  revision: number;
  action: WorkflowAction;
};
export type CorrectionPreview = {
  revision: string;
  requires_resolution: boolean;
  affected: {
    match_id: string;
    step_id: string;
    step_position: number | null;
    round: number | null;
    number: number | null;
    bracket: string | null;
    group_index: number | null;
    status: string;
    archived: boolean;
  }[];
};
export type CorrectionRequest = {
  operation_id: string;
  revision: string;
  reset_downstream: boolean;
  report: Report;
  reason: string;
};

export function historicalScores(value: unknown): ReportScore[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const rows = record.results ?? record.participants;
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is ReportScore =>
      !!row &&
      typeof row === 'object' &&
      typeof row.participant_id === 'string' &&
      row.stats &&
      typeof row.stats === 'object',
  );
}

export type DisplayStat = {
  key: string;
  name: string;
  type?: string;
  options?: { key: string; label: string }[];
};
export function describeValues(
  values: Record<string, unknown>,
  definitions: DisplayStat[],
  identities: Record<string, string>,
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  function append(raw: unknown, owner = '') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      const stat = definitions.find((s) => s.key === key);
      const display =
        stat?.type === 'mvp'
          ? (identities[String(value)] ?? '—')
          : (stat?.options?.find((o) => o.key === value)?.label ??
            String(value));
      rows.push({
        label: (owner ? owner + ' · ' : '') + (stat?.name ?? key),
        value: display,
      });
    }
  }
  if (values.total && typeof values.total === 'object') {
    append(values.total);
    if (values.players && typeof values.players === 'object')
      for (const [id, stats] of Object.entries(values.players))
        append(stats, identities[id] ?? '—');
  } else append(values);
  return rows;
}
