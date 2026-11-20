import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Mail01Icon from '@hugeicons/core-free-icons/Mail01Icon';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { ScreenState } from '@/components/ui/feedback';
import { StatusBadge } from '@/components/ui/status-badge';
import { StepOptionSelect } from '@/components/steps/option-select';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  invitationErrorKey,
  invitationNames,
  invitationStatuses,
  invitationTypes,
  listInvitations,
  type InvitationStatus,
  type InvitationType,
} from '@/features/invitations/api';
import { useTranslation } from '@/i18n';
import { useInvitationActivity } from '@/features/invitations/activity';

export default function InvitationsScreen() {
  const { user } = useAuth();
  return <Inbox key={user?.id ?? 'guest'} />;
}
function Inbox() {
  const { t, i18n } = useTranslation();
  const { responses, acknowledge, refresh } = useInvitationActivity();
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  const insets = useSafeAreaInsets();
  const [direction, setDirection] = useState<'incoming' | 'outgoing'>(
    'incoming',
  );
  const [status, setStatus] = useState<InvitationStatus | 'all'>('pending');
  const [type, setType] = useState<InvitationType | 'all'>('all');
  const [offset, setOffset] = useState(0);
  const load = useCallback(
    async (token: string) => {
      const page = await listInvitations(token, {
        direction,
        status: status === 'all' ? undefined : status,
        type: type === 'all' ? undefined : type,
        offset,
      });
      const items = await Promise.all(
        page.items.map(async (invitation) => ({
          ...invitation,
          names: await invitationNames(token, invitation),
        })),
      );
      return { ...page, items };
    },
    [direction, status, type, offset],
  );
  const state = useGameResource(load, invitationErrorKey);
  return (
    <View className="flex-1 bg-background">
      <View className="gap-4 px-5 pt-5 pb-3">
        {responses > 0 ? (
          <View className="gap-2">
            <Button
              onPress={() => {
                setDirection('outgoing');
                setStatus('all');
                setOffset(0);
              }}
            >
              <Text>{t('invitations.newResponses', { count: responses })}</Text>
            </Button>
            <Button variant="ghost" onPress={acknowledge}>
              <Text>{t('invitations.markRead')}</Text>
            </Button>
          </View>
        ) : null}
        <View className="flex-row gap-2">
          {(['incoming', 'outgoing'] as const).map((value) => (
            <Button
              key={value}
              className="flex-1"
              variant={direction === value ? 'default' : 'outline'}
              accessibilityState={{ selected: direction === value }}
              onPress={() => {
                setDirection(value);
                setOffset(0);
              }}
            >
              <Text>{t(`invitations.${value}`)}</Text>
            </Button>
          ))}
        </View>
        <StepOptionSelect
          label={t('invitations.status')}
          value={status}
          options={['all', ...invitationStatuses]}
          labelFor={(value) => t(`invitations.statuses.${value}`)}
          onSelect={(value) => {
            setStatus(value);
            setOffset(0);
          }}
        />
        <StepOptionSelect
          label={t('invitations.type')}
          value={type}
          options={['all', ...invitationTypes]}
          labelFor={(value) => t(`invitations.types.${value}`)}
          onSelect={(value) => {
            setType(value);
            setOffset(0);
          }}
        />
      </View>
      {(state.loading && !state.data) || state.error ? (
        <ScreenState
          loading={state.loading}
          error={Boolean(state.error)}
          message={t(state.error || 'common.loading')}
          onRetry={() => void state.reload()}
        />
      ) : (
        <FlatList
          data={state.data?.items ?? []}
          keyExtractor={(item) => item.id}
          contentContainerClassName="gap-3 px-5 py-3"
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          refreshControl={
            <RefreshControl
              refreshing={state.refreshing}
              onRefresh={() => void state.reload(true)}
            />
          }
          ListEmptyComponent={
            <View className="items-center gap-3 py-8">
              <Icon icon={Mail01Icon} size={32} tone="muted-foreground" />
              <Text className="font-semibold">{t('invitations.empty')}</Text>
              <Text variant="muted" className="text-center">
                {t('invitations.emptyDescription')}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Card className="gap-3 p-4">
              <Text className="text-lg font-semibold">
                {item.names.resource ?? t('invitations.resourceUnavailable')}
              </Text>
              <Text variant="muted">{t(`invitations.types.${item.type}`)}</Text>
              <StatusBadge
                status={item.status}
                label={t(`invitations.statuses.${item.status}`)}
              />
              {(
                direction === 'incoming'
                  ? item.names.inviter
                  : item.names.recipient
              ) ? (
                <Text variant="muted">
                  {t(
                    direction === 'incoming'
                      ? 'invitations.from'
                      : 'invitations.to',
                    {
                      name:
                        direction === 'incoming'
                          ? item.names.inviter
                          : item.names.recipient,
                    },
                  )}
                </Text>
              ) : null}
              {item.role ? (
                <Text variant="muted">
                  {t('invitations.role')}: {t(`teams.roles.${item.role}`)}
                </Text>
              ) : null}
              <Text variant="muted">
                {t('invitations.expires', {
                  date: new Date(item.expires_at).toLocaleString(i18n.language),
                })}
              </Text>
              {item.is_link ? (
                <Text variant="muted">
                  {t('invitations.usage', {
                    used: item.uses,
                    max: item.max_uses,
                  })}
                </Text>
              ) : null}
              <Button
                onPress={() =>
                  router.push({
                    pathname: '/invitations/[id]',
                    params: { id: item.id },
                  })
                }
              >
                <Text>{t('invitations.view')}</Text>
              </Button>
            </Card>
          )}
          ListFooterComponent={
            <View className="flex-row gap-3 py-2">
              <Button
                className="flex-1"
                variant="outline"
                disabled={offset === 0 || state.loading}
                onPress={() => setOffset(Math.max(0, offset - 20))}
              >
                <Text>{t('invitations.previous')}</Text>
              </Button>
              <Button
                className="flex-1"
                variant="outline"
                disabled={
                  offset + 20 >= (state.data?.total ?? 0) || state.loading
                }
                onPress={() => setOffset(offset + 20)}
              >
                <Text>{t('invitations.next')}</Text>
              </Button>
            </View>
          }
        />
      )}
    </View>
  );
}
