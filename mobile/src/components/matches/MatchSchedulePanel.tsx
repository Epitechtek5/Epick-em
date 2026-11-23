import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Calendar03Icon } from '@hugeicons/core-free-icons';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TournamentDateField } from '@/components/tournaments/date-field';
import { StepOptionSelect } from '@/components/steps/option-select';
import { useTranslation } from '@/i18n';
import type {
  WorkflowView,
  WorkflowAction,
  AttendanceStatus,
} from '@/features/matches/workflow-types';

export function MatchSchedulePanel({
  view,
  participants,
  names,
  busy,
  open,
  scheduled,
  onAction,
}: {
  view: WorkflowView;
  participants: string[];
  names: Record<string, string>;
  busy: boolean;
  open: boolean;
  scheduled: boolean;
  onAction: (action: WorkflowAction) => void;
}) {
  const { t, i18n } = useTranslation();
  const schedule = view.workflow.schedule;
  const [date, setDate] = useState(schedule.scheduled_at);
  const [duration, setDuration] = useState(
    schedule.duration_minutes?.toString() ?? '',
  );
  const [venue, setVenue] = useState(schedule.venue ?? '');
  const [station, setStation] = useState(schedule.station ?? '');
  const [minutes, setMinutes] = useState('');
  const [reason, setReason] = useState('');
  const admin = view.can_manage && open;
  const positive = (value: string) =>
    /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 1440;
  const statuses: AttendanceStatus[] = [
    'expected',
    'present',
    'late',
    'absent',
    'forfeit',
  ];
  function attendance(id: string, status: AttendanceStatus) {
    const action: WorkflowAction = {
      kind: 'attendance',
      participant_id: id,
      status,
      reason: reason.trim() || null,
    };
    if (status === 'forfeit') {
      Alert.alert(
        t('matchWorkflow.forfeit'),
        t('matchWorkflow.forfeitWarning'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.confirm'),
            style: 'destructive',
            onPress: () => onAction(action),
          },
        ],
      );
    } else onAction(action);
  }
  return (
    <View className="gap-4 rounded-xl border border-border bg-card p-4">
      <View className="flex-row items-center gap-2">
        <Icon icon={Calendar03Icon} tone="primary" />
        <Text className="text-lg font-semibold">
          {t('matchWorkflow.schedule')}
        </Text>
      </View>
      {admin ? (
        <>
          <TournamentDateField
            label={t('matchWorkflow.date')}
            value={date}
            onChange={setDate}
            optional
          />
          {(
            [
              [t('matchWorkflow.duration'), duration, setDuration],
              [t('matchWorkflow.venue'), venue, setVenue],
              [t('matchWorkflow.station'), station, setStation],
            ] as const
          ).map(([label, value, set]) => (
            <View key={label} className="gap-2">
              <Text>{label}</Text>
              <Input
                accessibilityLabel={label}
                value={value}
                onChangeText={set}
                editable={!busy}
              />
            </View>
          ))}
          <Button
            disabled={busy || !scheduled || (!!duration && !positive(duration))}
            onPress={() =>
              onAction({
                kind: 'schedule',
                scheduled_at: date,
                duration_minutes: duration ? Number(duration) : null,
                venue: venue.trim() || null,
                station: station.trim() || null,
              })
            }
          >
            <Text>{t('common.save')}</Text>
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onPress={() => onAction({ kind: 'call' })}
          >
            <Text>{t('matchWorkflow.call')}</Text>
          </Button>
          <Text>{t('matchWorkflow.reason')}</Text>
          <Input
            accessibilityLabel={t('matchWorkflow.reason')}
            value={reason}
            onChangeText={setReason}
            maxLength={2000}
            editable={!busy}
            multiline
          />
          <Text>{t('matchWorkflow.minutes')}</Text>
          <Input
            accessibilityLabel={t('matchWorkflow.minutes')}
            value={minutes}
            onChangeText={setMinutes}
            editable={!busy}
            keyboardType="number-pad"
          />
          <Button
            variant="outline"
            disabled={busy || !positive(minutes) || !reason.trim()}
            onPress={() =>
              onAction({ kind: 'delay', minutes: Number(minutes), reason })
            }
          >
            <Text>{t('matchWorkflow.delay')}</Text>
          </Button>
        </>
      ) : (
        <>
          <Text>
            {schedule.scheduled_at
              ? new Date(schedule.scheduled_at).toLocaleString(i18n.language)
              : t('matches.notScheduled')}
          </Text>
          {schedule.duration_minutes ? (
            <Text>
              {t('matchWorkflow.duration')} : {schedule.duration_minutes}
            </Text>
          ) : null}
          {schedule.venue ? <Text>{schedule.venue}</Text> : null}
          {schedule.station ? (
            <Text>
              {t('matchWorkflow.station')} : {schedule.station}
            </Text>
          ) : null}
        </>
      )}
      {schedule.called_at ? (
        <Text className="font-medium text-primary">
          {t('matchWorkflow.called')}
        </Text>
      ) : null}
      {schedule.delay_minutes > 0 ? (
        <Text>
          {t('matchWorkflow.minutes')} : {schedule.delay_minutes}
        </Text>
      ) : null}
      {participants.map((id) => (
        <View key={id} className="gap-2 border-t border-border pt-3">
          <Text className="font-medium">
            {names[id] ?? t('steps.unknownParticipant')}
          </Text>
          {admin ? (
            <StepOptionSelect
              label={names[id] ?? t('matches.participants')}
              value={view.workflow.attendance[id]?.status ?? 'expected'}
              options={statuses.filter(
                (s) => !['absent', 'forfeit'].includes(s) || !!reason.trim(),
              )}
              labelFor={(s) => t('matchWorkflow.' + s)}
              disabled={busy}
              onSelect={(s) => attendance(id, s as AttendanceStatus)}
            />
          ) : (
            <Text>
              {t(
                'matchWorkflow.' +
                  (view.workflow.attendance[id]?.status ?? 'expected'),
              )}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
