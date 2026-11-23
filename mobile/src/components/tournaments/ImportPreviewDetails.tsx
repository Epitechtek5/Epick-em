import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { FormMessage } from '@/components/ui/feedback';
import { useTranslation } from '@/i18n';
import type {
  ImportPreview,
  PreviewStep,
  TournamentPreview,
} from '@/features/tournaments/import-preview';

const PAGE_SIZE = 20;

function Disclosure({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <View className="rounded-xl border border-border bg-card">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        className="min-h-12 flex-row items-center justify-between gap-3 p-4"
      >
        <View className="flex-1 gap-1">
          <Text className="font-semibold">{title}</Text>
          {subtitle ? <Text variant="muted">{subtitle}</Text> : null}
        </View>
        <Text className="text-sm text-primary">
          {t(open ? 'importPreview.hide' : 'importPreview.show')}
        </Text>
      </Pressable>
      {open ? <View className="gap-3 px-4 pb-4">{children}</View> : null}
    </View>
  );
}

function Page<T>({
  items,
  render,
}: {
  items: T[];
  render: (item: T, index: number) => ReactNode;
}) {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(PAGE_SIZE);
  return (
    <View className="gap-3">
      {items.slice(0, limit).map(render)}
      {limit < items.length ? (
        <Button variant="outline" onPress={() => setLimit(limit + PAGE_SIZE)}>
          <Text>
            {t('importPreview.more', { count: items.length - limit })}
          </Text>
        </Button>
      ) : null}
    </View>
  );
}

function StepDetails({ step }: { step: PreviewStep }) {
  const { t } = useTranslation();
  return (
    <Disclosure
      title={t('steps.position', { position: step.position })}
      subtitle={t(`steps.status.${step.status}`)}
    >
      {step.groups.length === 0 ? (
        <Text variant="muted">{t('steps.noGroups')}</Text>
      ) : null}
      <Page
        items={step.groups}
        render={(group) => (
          <Disclosure
            key={group.index}
            title={t('steps.group', { index: group.index })}
          >
            <Page
              items={group.participants}
              render={(participant, index) => (
                <View key={index} className="gap-1 border-t border-border pt-3">
                  <Text className="font-medium">{participant.name}</Text>
                  <Text variant="muted">
                    {participant.seed === null
                      ? t('importPreview.unseeded')
                      : t('importPreview.seed', { seed: participant.seed })}
                  </Text>
                  <Text variant="muted">
                    {t('tournaments.points', { points: participant.points })}
                    {' · '}
                    {t(`steps.participantStatus.${participant.status}`)}
                  </Text>
                  {participant.rank !== null ? (
                    <Text variant="muted">
                      {t('importPreview.rank', { rank: participant.rank })}
                    </Text>
                  ) : null}
                </View>
              )}
            />
          </Disclosure>
        )}
      />
      <Disclosure
        title={t('importPreview.matchResults', { count: step.matches.length })}
      >
        {step.matches.length === 0 ? (
          <Text variant="muted">{t('matches.empty')}</Text>
        ) : null}
        <Page
          items={step.matches}
          render={(match) => (
            <View
              key={match.index}
              className="gap-2 border-t border-border pt-3"
            >
              <Text className="font-medium">
                {t('matches.number', { number: match.index })}
              </Text>
              <Text variant="muted">{t(`matches.status.${match.status}`)}</Text>
              <Page
                items={match.participants}
                render={(participant, index) => (
                  <View key={index} className="gap-1">
                    <Text>{participant.name}</Text>
                    <Text variant="muted">
                      {t('tournaments.points', { points: participant.points })}
                      {participant.result
                        ? ` · ${t(`matches.outcome.${participant.result}`)}`
                        : ''}
                      {participant.rank !== null
                        ? ` · ${t('importPreview.rank', { rank: participant.rank })}`
                        : ''}
                    </Text>
                  </View>
                )}
              />
              {match.next !== null ? (
                <Text variant="muted">
                  {t('importPreview.progression', { number: match.next })}
                </Text>
              ) : null}
            </View>
          )}
        />
      </Disclosure>
    </Disclosure>
  );
}

function TournamentDetails({ tournament }: { tournament: TournamentPreview }) {
  const { t } = useTranslation();
  return (
    <Disclosure
      title={tournament.name}
      subtitle={`${tournament.game} · ${t(`importPreview.actions.${tournament.action}`)}`}
    >
      {tournament.destructive ? (
        <FormMessage>{t('importPreview.destructive')}</FormMessage>
      ) : null}
      {tournament.changes.map((change, index) => (
        <View key={index} className="gap-1 border-t border-border pt-3">
          <View className="flex-row flex-wrap justify-between gap-2">
            <Text className="font-medium">
              {t(`importPreview.resources.${change.resource}`)}
            </Text>
            <Text
              className={
                change.action === 'delete' || change.action === 'replace'
                  ? 'text-sm text-destructive'
                  : 'text-sm text-primary'
              }
            >
              {t(`importPreview.actions.${change.action}`)}
            </Text>
          </View>
          <Text variant="muted">
            {t('importPreview.countChange', {
              before: change.before,
              after: change.after,
            })}
          </Text>
          {change.details ? (
            <Text variant="muted">
              {t('importPreview.serverDetail', { detail: change.details })}
            </Text>
          ) : null}
        </View>
      ))}
      {tournament.steps ? (
        <Disclosure title={t('importPreview.placements')}>
          <Page
            items={tournament.steps}
            render={(step) => <StepDetails key={step.position} step={step} />}
          />
        </Disclosure>
      ) : (
        <Text variant="muted">{t('importPreview.detailsUnavailable')}</Text>
      )}
      {tournament.downstream.length > 0 ? (
        <Disclosure title={t('importPreview.impacts')}>
          <Text variant="muted">{t('importPreview.serverLanguage')}</Text>
          <Page
            items={tournament.downstream}
            render={(line, index) => (
              <Text key={index} className="text-sm">
                {line}
              </Text>
            )}
          />
        </Disclosure>
      ) : null}
    </Disclosure>
  );
}

export function ImportPreviewDetails({ preview }: { preview: ImportPreview }) {
  const { t } = useTranslation();
  const actions = ['create', 'update', 'replace', 'delete'] as const;
  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap gap-3 rounded-xl bg-muted p-4">
        {actions.map((action) => (
          <View key={action} className="min-w-24 flex-1 gap-1">
            <Text className="text-xl font-semibold">
              {
                preview.tournaments
                  .flatMap((item) => item.changes)
                  .filter((change) => change.action === action).length
              }
            </Text>
            <Text variant="muted">{t(`importPreview.actions.${action}`)}</Text>
          </View>
        ))}
      </View>
      <Text variant="muted">{t('importPreview.resourceCounts')}</Text>
      {preview.errors.length > 0 ? (
        <View className="gap-3 rounded-xl border border-destructive p-4">
          <Text
            className="font-semibold text-destructive"
            accessibilityRole="alert"
          >
            {t('importPreview.validationErrors', {
              count: preview.errors.length,
            })}
          </Text>
          <Text variant="muted">{t('importPreview.serverLanguage')}</Text>
          <Page
            items={preview.errors}
            render={(message, index) => (
              <Text key={index} className="text-sm">
                {message}
              </Text>
            )}
          />
        </View>
      ) : null}
      {preview.warnings.length > 0 ? (
        <Disclosure
          title={t('importPreview.warnings', {
            count: preview.warnings.length,
          })}
        >
          <Text variant="muted">{t('importPreview.serverLanguage')}</Text>
          <Page
            items={preview.warnings}
            render={(message, index) => (
              <Text key={index} className="text-sm">
                {message}
              </Text>
            )}
          />
        </Disclosure>
      ) : null}
      <Page
        items={preview.tournaments}
        render={(tournament, index) => (
          <TournamentDetails key={index} tournament={tournament} />
        )}
      />
    </View>
  );
}
