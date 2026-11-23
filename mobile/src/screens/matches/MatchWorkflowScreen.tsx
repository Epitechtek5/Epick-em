import {
  historicalScores,
  describeValues,
} from '@/features/matches/workflow-types';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import { Attachment01Icon, RefreshIcon } from '@hugeicons/core-free-icons';
import { useAuth } from '@/features/auth/session';
import { useMatchContext, matchError } from '@/features/matches/context';
import { useGameResource } from '@/features/games/use-game-resource';
import { useMatchAction } from '@/features/matches/use-match-action';
import { matchApi } from '@/features/matches/api';
import type {
  WorkflowAction,
  WorkflowRequest,
  Report,
  CorrectionPreview,
  CorrectionRequest,
} from '@/features/matches/workflow-types';
import { authenticatedRequest, ApiError } from '@/lib/api';
import { authenticatedHeaders } from '@/features/users/api';
import { MatchPage, MatchState } from '@/components/matches/MatchPage';
import { MatchSchedulePanel } from '@/components/matches/MatchSchedulePanel';
import { MatchReportEditor } from '@/components/matches/MatchReportEditor';
import { MatchScoreboard } from '@/components/matches/MatchScoreboard';
import { StepOptionSelect } from '@/components/steps/option-select';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Input } from '@/components/ui/input';
import { Icon } from '@/components/ui/icon';
import { FormMessage } from '@/components/ui/feedback';
import { useTranslation } from '@/i18n';

export default function MatchWorkflowScreen() {
  const { t, i18n } = useTranslation();
  const { token } = useAuth();
  const context = useMatchContext();
  const { tournamentId, stepId, matchId = '' } = context;
  const load = useCallback(
    (access: string) =>
      matchApi(access, tournamentId, stepId).workflow(matchId),
    [tournamentId, stepId, matchId],
  );
  const resource = useGameResource(load, matchError);
  const action = useMatchAction();
  const pending = useRef<{ key: string; request: WorkflowRequest } | null>(
    null,
  );
  const correction = useRef<CorrectionRequest | null>(null);
  const [tab, setTab] = useState('reports');
  const [editing, setEditing] = useState(false);
  const [adminDecision, setAdminDecision] = useState(false);
  const [reason, setReason] = useState('');
  const [selectedReport, setSelectedReport] = useState('');
  const [acceptClaim, setAcceptClaim] = useState(true);
  const [attachments, setAttachments] = useState<
    { id: string; name: string }[]
  >([]);
  const [preview, setPreview] = useState<{
    impact: CorrectionPreview;
    report: Report;
    reason: string;
  } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [notice, setNotice] = useState(false);
  if (!context.data?.match || !token) return <MatchState {...context} />;
  if (!resource.data) return <MatchState {...resource} />;
  const data = context.data;
  const match = data.match!;
  const view = resource.data;
  const workflow = view.workflow;
  const api = matchApi(token, tournamentId, stepId);
  const base = `/tournaments/${tournamentId}/steps/${stepId}/matches/${matchId}`;
  const open = ['scheduled', 'ongoing'].includes(match.status);
  const name = (id: string) => data.names[id] ?? t('steps.unknownParticipant');
  async function send(value: WorkflowAction) {
    const key = JSON.stringify(value);
    if (pending.current?.key !== key)
      pending.current = {
        key,
        request: {
          operation_id: randomUUID(),
          revision: workflow.revision,
          action: value,
        },
      };
    const request = pending.current.request;
    await action.run(async () => {
      try {
        const next = await api.updateWorkflow(matchId, request);
        resource.setData(next);
        pending.current = null;
        setNotice(true);
        setEditing(false);
        setReason('');
        setAttachments([]);
        await context.reload();
      } catch (error) {
        if (error instanceof ApiError && error.status < 500) {
          pending.current = null;
          await resource.reload();
        }
        throw error;
      }
    });
  }
  function submit(report: Report) {
    if (match.status === 'finished') {
      void action.run(async () => {
        const impact = await api.previewCorrection(matchId, report, reason);
        setPreview({ impact, report, reason });
        setAcknowledged(false);
        correction.current = null;
      });
    } else
      void send(
        adminDecision
          ? { kind: 'adjudicate', report, reason }
          : { kind: 'submit', report },
      );
  }
  async function attach() {
    await action.run(async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['image/png', 'image/jpeg', 'application/pdf'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const file = new File(asset.uri);
      if (
        !asset.mimeType ||
        !['image/png', 'image/jpeg', 'application/pdf'].includes(
          asset.mimeType,
        ) ||
        file.size > 5 * 1024 * 1024 ||
        file.size === 0
      ) {
        action.setError('matchWorkflow.invalidFile');
        return;
      }
      const id = randomUUID();
      await authenticatedRequest(base + '/evidence/' + id, {
        method: 'PUT',
        headers: {
          ...authenticatedHeaders(token!),
          'Content-Type': asset.mimeType,
          'x-filename': encodeURIComponent(asset.name),
        },
        body: await file.bytes(),
      });
      setAttachments((previous) => [...previous, { id, name: asset.name }]);
    });
  }
  async function download(id: string) {
    await action.run(async () => {
      const response = await authenticatedRequest<Response>(
        base + '/evidence/' + id,
        { headers: authenticatedHeaders(token!), responseType: 'response' },
      );
      const extension = response.headers.get('content-type')?.includes('pdf')
        ? 'pdf'
        : response.headers.get('content-type')?.includes('png')
          ? 'png'
          : 'jpg';
      const file = new File(Paths.cache, `evidence-${id}.${extension}`);
      try {
        file.write(new Uint8Array(await response.arrayBuffer()));
        await Sharing.shareAsync(file.uri);
      } finally {
        if (file.exists) file.delete();
      }
    });
  }
  return (
    <MatchPage>
      <MatchScoreboard match={match} data={data} />
      <Button
        variant="outline"
        disabled={action.busy}
        onPress={() => {
          void resource.reload();
          void context.reload();
        }}
      >
        <Icon icon={RefreshIcon} />
        <Text>{t('matchWorkflow.refresh')}</Text>
      </Button>
      {action.error ? (
        <FormMessage>
          {t(action.error) + ' ' + t('matchWorkflow.retryHint')}
        </FormMessage>
      ) : null}
      {notice ? (
        <FormMessage success>{t('matchWorkflow.saved')}</FormMessage>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {['reports', 'schedule', 'disputes', 'history'].map((value) => (
          <Button
            key={value}
            size="sm"
            variant={tab === value ? 'default' : 'outline'}
            onPress={() => setTab(value)}
          >
            <Text>{t('matchWorkflow.' + value)}</Text>
          </Button>
        ))}
      </View>
      {tab === 'schedule' ? (
        <MatchSchedulePanel
          key={workflow.revision}
          view={view}
          participants={match.participants.map((p) => p.participant_id)}
          names={data.names}
          busy={action.busy}
          open={open}
          scheduled={match.status === 'scheduled'}
          onAction={(value) => void send(value)}
        />
      ) : null}
      {tab === 'reports' ? (
        <>
          <Text className="text-muted-foreground">
            {t('matchWorkflow.independent')}
          </Text>
          {!workflow.submissions.length ? (
            <Text>{t('matchWorkflow.emptyReports')}</Text>
          ) : null}
          {workflow.submissions.map((submission, index) => (
            <View
              key={submission.id}
              className="gap-3 rounded-xl border border-border bg-card p-4"
            >
              <Text className="text-lg font-semibold">
                {t('matchWorkflow.reportNumber')} {index + 1} ·{' '}
                {name(submission.participant_id)}
              </Text>
              <Text className="text-primary">
                {t('matchWorkflow.' + submission.status)}
              </Text>
              <Text>
                {t('matchWorkflow.confirmations')} :{' '}
                {Object.keys(submission.confirmations).length}/
                {match.participants.length}
              </Text>
              {submission.results.map((score) => (
                <View
                  key={score.participant_id}
                  className="flex-row justify-between gap-2"
                >
                  <Text>{name(score.participant_id)}</Text>
                  <Text>
                    {score.rank ?? '—'}
                    {score.games_won != null
                      ? ` · ${score.games_won} ${t('matchWorkflow.wins')}`
                      : ''}
                  </Text>
                </View>
              ))}
              {submission.games.map((game, index) => (
                <View key={index} className="gap-2 border-t border-border pt-3">
                  <Text className="font-semibold">
                    {t('matchWorkflow.game')} {index + 1}
                  </Text>
                  {describeValues(
                    game.attributes,
                    data.statDefinitions,
                    view.identities ?? data.names,
                  ).map((line, i) => (
                    <Text key={i}>
                      {line.label} : {line.value}
                    </Text>
                  ))}
                  {game.results.map((score) => (
                    <View key={score.participant_id} className="gap-1">
                      <Text className="font-medium">
                        {name(score.participant_id)} · {t('matchWorkflow.rank')}{' '}
                        {score.rank ?? '—'}
                      </Text>
                      {describeValues(
                        score.stats,
                        data.statDefinitions,
                        view.identities ?? data.names,
                      ).map((line, i) => (
                        <Text key={i}>
                          {line.label} : {line.value}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              ))}
              {open &&
              view.participant_id &&
              submission.status === 'pending' &&
              !submission.confirmations[view.participant_id] ? (
                <Button
                  disabled={action.busy}
                  onPress={() =>
                    void send({ kind: 'confirm', submission_id: submission.id })
                  }
                >
                  <Text>{t('matchWorkflow.confirm')}</Text>
                </Button>
              ) : null}
              {(open || match.status === 'finished') && view.participant_id ? (
                <Button
                  variant="outline"
                  onPress={() => {
                    setSelectedReport(submission.id);
                    setTab('disputes');
                  }}
                >
                  <Text>{t('matchWorkflow.dispute')}</Text>
                </Button>
              ) : null}
            </View>
          ))}
          {open && view.participant_id ? (
            <Button
              onPress={() => {
                setAdminDecision(false);
                setEditing(!editing);
                setPreview(null);
              }}
            >
              <Text>{t('matchWorkflow.submit')}</Text>
            </Button>
          ) : null}
          {view.can_manage && (open || match.status === 'finished') ? (
            <Button
              variant={view.participant_id && open ? 'outline' : 'default'}
              onPress={() => {
                setAdminDecision(true);
                setEditing(!editing);
                setPreview(null);
              }}
            >
              <Text>
                {t(
                  match.status === 'finished'
                    ? 'matchWorkflow.correct'
                    : 'matchWorkflow.adjudicate',
                )}
              </Text>
            </Button>
          ) : null}
          {editing ? (
            <>
              {adminDecision ? (
                <>
                  <Text>{t('matchWorkflow.reason')}</Text>
                  <Input
                    accessibilityLabel={t('matchWorkflow.reason')}
                    multiline
                    value={reason}
                    onChangeText={(value) => {
                      setReason(value);
                      setPreview(null);
                    }}
                    maxLength={2000}
                  />
                </>
              ) : null}
              <MatchReportEditor
                context={data}
                match={match}
                busy={action.busy || (adminDecision && !reason.trim())}
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
            <View className="gap-3 rounded-xl border border-border bg-card p-4">
              <Text className="text-lg font-semibold">
                {t('matchWorkflow.impact')}
              </Text>
              <Text>
                {t(
                  preview.impact.requires_resolution
                    ? 'matchWorkflow.impactHint'
                    : 'matchWorkflow.noImpact',
                )}
              </Text>
              {preview.impact.affected.map((affected) => (
                <Text key={affected.match_id}>
                  {t('matchWorkflow.impactMatch', {
                    step: affected.step_position ?? '—',
                    round: affected.round ?? '—',
                    number: affected.number ?? '—',
                    group: affected.group_index ?? '—',
                  })}{' '}
                  {affected.bracket
                    ? t('matches.region.' + affected.bracket)
                    : ''}{' '}
                  ·{' '}
                  {t(
                    'matchWorkflow.' +
                      (affected.archived ? 'archived' : 'reset'),
                  )}
                </Text>
              ))}
              {preview.impact.requires_resolution ? (
                <Button
                  variant={acknowledged ? 'secondary' : 'outline'}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: acknowledged }}
                  onPress={() => setAcknowledged(!acknowledged)}
                >
                  <Text>{t('matchWorkflow.acknowledge')}</Text>
                </Button>
              ) : null}
              <Button
                disabled={
                  action.busy ||
                  (preview.impact.requires_resolution && !acknowledged)
                }
                onPress={() =>
                  void action.run(async () => {
                    correction.current ??= {
                      operation_id: randomUUID(),
                      revision: preview.impact.revision,
                      reset_downstream: acknowledged,
                      report: preview.report,
                      reason: preview.reason,
                    };
                    await api.correct(matchId, correction.current);
                    correction.current = null;
                    setPreview(null);
                    setEditing(false);
                    setNotice(true);
                    await resource.reload();
                    await context.reload();
                  })
                }
              >
                <Text>{t('matchWorkflow.applyCorrection')}</Text>
              </Button>
            </View>
          ) : null}
        </>
      ) : null}
      {tab === 'disputes' ? (
        <>
          {!workflow.disputes.length ? (
            <Text>{t('matchWorkflow.emptyDisputes')}</Text>
          ) : null}
          {workflow.disputes.map((dispute) => (
            <View
              key={dispute.id}
              className="gap-3 rounded-xl border border-border bg-card p-4"
            >
              <Text>{dispute.reason}</Text>
              {dispute.evidence.map((id, i) => (
                <Button
                  key={id}
                  variant="outline"
                  disabled={action.busy}
                  onPress={() => void download(id)}
                >
                  <Icon icon={Attachment01Icon} />
                  <Text>
                    {t('matchWorkflow.attachment')} {i + 1}
                  </Text>
                </Button>
              ))}
              {dispute.decision ? (
                <>
                  <Text className="font-semibold">
                    {t('matchWorkflow.resolution')}
                  </Text>
                  <Text>{dispute.decision.reason}</Text>
                </>
              ) : view.can_manage && open ? (
                <>
                  <StepOptionSelect
                    label={t('matchWorkflow.resolution')}
                    value={acceptClaim ? 'acceptClaim' : 'rejectClaim'}
                    options={['acceptClaim', 'rejectClaim']}
                    labelFor={(key) => t('matchWorkflow.' + key)}
                    onSelect={(key) => setAcceptClaim(key === 'acceptClaim')}
                  />
                  {!workflow.submissions.length ? (
                    <Button
                      onPress={() => {
                        setTab('reports');
                        setAdminDecision(true);
                        setEditing(true);
                      }}
                    >
                      <Text>{t('matchWorkflow.adjudicate')}</Text>
                    </Button>
                  ) : null}
                  <StepOptionSelect
                    label={t('matchWorkflow.chosenReport')}
                    value={selectedReport}
                    options={workflow.submissions
                      .filter((s) => s.status !== 'rejected')
                      .map((s) => s.id)}
                    labelFor={(id) => {
                      const s = workflow.submissions.find((s) => s.id === id);
                      return s
                        ? `${t('matchWorkflow.reportNumber')} ${workflow.submissions.indexOf(s) + 1} · ${name(s.participant_id)}`
                        : t('matches.unset');
                    }}
                    onSelect={setSelectedReport}
                  />
                  <Text>{t('matchWorkflow.reason')}</Text>
                  <Input
                    accessibilityLabel={t('matchWorkflow.reason')}
                    multiline
                    value={reason}
                    onChangeText={setReason}
                    maxLength={2000}
                  />
                  <Button
                    disabled={action.busy || !reason.trim() || !selectedReport}
                    onPress={() =>
                      void send({
                        kind: 'resolve',
                        dispute_id: dispute.id,
                        submission_id: selectedReport,
                        accepted: acceptClaim,
                        reason,
                      })
                    }
                  >
                    <Text>{t('matchWorkflow.resolve')}</Text>
                  </Button>
                </>
              ) : (
                <Text>{t('matchWorkflow.disputed')}</Text>
              )}
            </View>
          ))}
          {(open || match.status === 'finished') && view.participant_id ? (
            <View className="gap-3">
              <Text>{t('matchWorkflow.reason')}</Text>
              <Input
                accessibilityLabel={t('matchWorkflow.reason')}
                multiline
                value={reason}
                onChangeText={setReason}
                maxLength={2000}
              />
              <Text className="text-sm text-muted-foreground">
                {t('matchWorkflow.attachmentHint')}
              </Text>
              {attachments.map((a) => (
                <Button
                  key={a.id}
                  variant="outline"
                  onPress={() =>
                    setAttachments(
                      attachments.filter((item) => item.id !== a.id),
                    )
                  }
                >
                  <Text>{a.name} ×</Text>
                </Button>
              ))}
              <Button
                variant="outline"
                disabled={action.busy || attachments.length >= 5}
                onPress={() => void attach()}
              >
                <Icon icon={Attachment01Icon} />
                <Text>{t('matchWorkflow.attach')}</Text>
              </Button>
              <Button
                disabled={action.busy || !reason.trim()}
                onPress={() =>
                  void send({
                    kind: 'dispute',
                    submission_id: selectedReport || null,
                    reason,
                    evidence: attachments.map((a) => a.id),
                  })
                }
              >
                <Text>{t('matchWorkflow.dispute')}</Text>
              </Button>
            </View>
          ) : null}
        </>
      ) : null}
      {tab === 'history' ? (
        <>
          {!workflow.history.length ? (
            <Text>{t('matchWorkflow.emptyHistory')}</Text>
          ) : null}
          {[...workflow.history].reverse().map((entry) => (
            <View
              key={entry.id}
              className="gap-2 rounded-xl border border-border bg-card p-4"
            >
              <Text className="font-semibold">
                {t(
                  'matchWorkflow.events.' + entry.action.replace('match.', ''),
                )}
              </Text>
              <Text className="text-sm text-muted-foreground">
                {new Date(entry.created_at).toLocaleString(i18n.language)}
              </Text>
              <Text>
                {view.identities?.[entry.actor_id] ??
                  t('steps.unknownParticipant')}
              </Text>
              {entry.reason ? <Text>{entry.reason}</Text> : null}
              {entry.action === 'match.corrected' ? (
                <>
                  <Text className="font-medium">
                    {t('matchWorkflow.previousResults')}
                  </Text>
                  {historicalScores(entry.before).map((score) => (
                    <Text key={score.participant_id}>
                      {name(score.participant_id)} · {score.rank ?? '—'}
                      {score.games_won != null
                        ? ` · ${score.games_won} ${t('matchWorkflow.wins')}`
                        : ''}
                    </Text>
                  ))}
                </>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
    </MatchPage>
  );
}
