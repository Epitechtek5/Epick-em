import { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView, Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { Input } from '@/components/ui/input';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { StepOptionSelect } from '@/components/steps/option-select';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import { listUsers } from '@/features/users/api';
import {
  createInvitation,
  actOnInvitation,
  invitationErrorKey,
  invitationResource,
  invitationTypes,
  type CreatedInvitation,
  type InvitationType,
} from '@/features/invitations/api';
import { useInvitationLifetime } from '@/features/invitations/navigation';
import { useTranslation } from '@/i18n';

export default function CreateInvitationScreen() {
  const { user } = useAuth();
  const { type, resourceId } = useLocalSearchParams<{
    type?: string;
    resourceId?: string;
  }>();
  const validType = invitationTypes.find((value) => value === type);
  const { t } = useTranslation();
  if (!validType || !resourceId)
    return <ScreenState error message={t('invitations.errors.unavailable')} />;
  return (
    <Create
      key={`${user?.id}:${type}:${resourceId}`}
      type={validType}
      resourceId={resourceId}
    />
  );
}
function Create({
  type,
  resourceId,
}: {
  type: InvitationType;
  resourceId: string;
}) {
  const { t } = useTranslation();
  const { user, token } = useAuth();
  const active = useInvitationLifetime();
  const lock = useRef(false);
  const [mode, setMode] = useState<'user' | 'link'>('user');
  const [role, setRole] = useState<'member' | 'substitute'>('member');
  const [ttl, setTtl] = useState<'default' | '24' | '168'>('default');
  const [uses, setUses] = useState('1');
  const [recipient, setRecipient] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const load = useCallback(
    (accessToken: string) => invitationResource(accessToken, type, resourceId),
    [type, resourceId],
  );
  const resource = useGameResource(load, invitationErrorKey);
  const loadUsers = useCallback(
    (accessToken: string) =>
      mode === 'user'
        ? listUsers(accessToken, { limit: 20, offset: page * 20 })
        : Promise.resolve([]),
    [page, mode],
  );
  const users = useGameResource(loadUsers, invitationErrorKey);
  const matchingUsers = (users.data ?? []).filter(
    (account) =>
      account.id !== user?.id &&
      account.username
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const target = resource.data;
  const allowed =
    target &&
    (type === 'tournament'
      ? user?.role === 'admin' &&
        'participant_type' in target &&
        target.participant_type === 'solo' &&
        ['draft', 'registration'].includes(target.status)
      : 'owner_id' in target && target.owner_id === user?.id);
  async function submit() {
    if (!active.current || !token || !allowed || lock.current) return;
    if (mode === 'user' && !recipient) {
      setError('invitations.errors.recipient');
      return;
    }
    if (
      mode === 'link' &&
      (!/^\d+$/.test(uses) || Number(uses) < 1 || Number(uses) > 1000)
    ) {
      setError('invitations.errors.uses');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await createInvitation(token, {
        type,
        resource_id: resourceId,
        ...(mode === 'user'
          ? { recipient_id: recipient }
          : { max_uses: Number(uses) }),
        ...(type !== 'tournament' ? { role } : {}),
        ...(ttl !== 'default' ? { expires_in_hours: Number(ttl) } : {}),
      });
      if (active.current) setCreated(result);
    } catch (caught) {
      if (active.current) setError(invitationErrorKey(caught));
    } finally {
      if (active.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function share() {
    if (!active.current || !created?.link || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await Share.share({ message: created.link });
    } catch {
      if (active.current) setError('invitations.errors.share');
    } finally {
      if (active.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  function revoke() {
    Alert.alert(t('invitations.revoke'), t('invitations.confirm.revoke'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('invitations.revoke'),
        style: 'destructive',
        onPress: () => {
          if (!active.current || !token || !created || lock.current) return;
          lock.current = true;
          setBusy(true);
          setError('');
          void actOnInvitation(token, created.id, 'revoke')
            .then(() => {
              if (active.current)
                setCreated({
                  ...created,
                  status: 'revoked',
                  token: null,
                  link: null,
                });
            })
            .catch((caught: unknown) => {
              if (active.current) setError(invitationErrorKey(caught));
            })
            .finally(() => {
              if (active.current) {
                lock.current = false;
                setBusy(false);
              }
            });
        },
      },
    ]);
  }
  if (resource.loading || resource.error || !target)
    return (
      <ScreenState
        loading={resource.loading}
        error={Boolean(resource.error)}
        message={t(resource.error || 'common.loading')}
        onRetry={() => void resource.reload()}
      />
    );
  if (!allowed)
    return <ScreenState error message={t('invitations.errors.forbidden')} />;
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-5 px-5 py-5"
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <Card className="gap-2 p-4">
        <Text variant="h3">{target.name}</Text>
        <Text variant="muted">{t(`invitations.types.${type}`)}</Text>
      </Card>
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
      {created ? (
        <View className="gap-4">
          <Text accessibilityLiveRegion="polite">
            {t(
              created.status === 'revoked'
                ? 'invitations.messages.revoke'
                : 'invitations.sent',
            )}
          </Text>
          {created.link ? (
            <>
              <Text variant="muted">{t('invitations.shareNow')}</Text>
              <Button disabled={busy} onPress={() => void share()}>
                <Text>{t('invitations.share')}</Text>
              </Button>
              <Button variant="outline" disabled={busy} onPress={revoke}>
                <Text className="text-destructive">
                  {t('invitations.revoke')}
                </Text>
              </Button>
            </>
          ) : null}
          <Button
            variant={created.link ? 'outline' : 'default'}
            disabled={busy}
            onPress={() =>
              router.replace({
                pathname: '/invitations/[id]',
                params: { id: created.id },
              })
            }
          >
            <Text>{t('invitations.done')}</Text>
          </Button>
        </View>
      ) : (
        <>
          <View className="gap-2">
            {(['user', 'link'] as const).map((value) => (
              <Button
                key={value}
                disabled={busy}
                className="w-full"
                variant={mode === value ? 'default' : 'outline'}
                accessibilityState={{ selected: mode === value }}
                onPress={() => setMode(value)}
              >
                <Text>{t(`invitations.modes.${value}`)}</Text>
              </Button>
            ))}
          </View>
          {mode === 'user' ? (
            <View className="gap-3">
              <Text className="font-medium">{t('invitations.recipient')}</Text>
              <Input
                accessibilityLabel={t('invitations.search')}
                placeholder={t('invitations.search')}
                value={search}
                onChangeText={setSearch}
                editable={!busy}
              />
              <Text variant="muted">{t('invitations.searchPage')}</Text>
              {users.loading || users.error ? (
                <ScreenState
                  loading={users.loading}
                  error={Boolean(users.error)}
                  message={t(users.error || 'common.loading')}
                  onRetry={() => void users.reload()}
                />
              ) : matchingUsers.length === 0 ? (
                <Text variant="muted">{t('teams.noMatchingUsers')}</Text>
              ) : (
                matchingUsers.map((account) => (
                  <Button
                    key={account.id}
                    disabled={busy}
                    variant={recipient === account.id ? 'secondary' : 'outline'}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: recipient === account.id }}
                    onPress={() => setRecipient(account.id)}
                  >
                    <Text>{account.username}</Text>
                  </Button>
                ))
              )}
              <View className="flex-row gap-2">
                <Button
                  className="flex-1"
                  variant="outline"
                  disabled={busy || page === 0}
                  onPress={() => {
                    setPage(page - 1);
                    setRecipient('');
                  }}
                >
                  <Text>{t('invitations.previous')}</Text>
                </Button>
                <Button
                  className="flex-1"
                  variant="outline"
                  disabled={busy || (users.data?.length ?? 0) < 20}
                  onPress={() => {
                    setPage(page + 1);
                    setRecipient('');
                  }}
                >
                  <Text>{t('invitations.next')}</Text>
                </Button>
              </View>
            </View>
          ) : (
            <View className="gap-2">
              <Text>{t('invitations.maxUses')}</Text>
              <Input
                accessibilityLabel={t('invitations.maxUses')}
                keyboardType="number-pad"
                value={uses}
                onChangeText={setUses}
                editable={!busy}
              />
            </View>
          )}
          {type !== 'tournament' ? (
            <StepOptionSelect
              label={t('invitations.role')}
              value={role}
              options={['member', 'substitute']}
              labelFor={(value) => t(`teams.roles.${value}`)}
              onSelect={setRole}
              disabled={busy}
            />
          ) : null}
          <StepOptionSelect
            label={t('invitations.validity')}
            value={ttl}
            options={['default', '24', '168']}
            labelFor={(value) => t(`invitations.ttl.${value}`)}
            onSelect={setTtl}
            disabled={busy}
          />
          <Button disabled={busy} onPress={() => void submit()}>
            <Text>
              {t(
                busy
                  ? 'common.loading'
                  : mode === 'user'
                    ? 'invitations.send'
                    : 'invitations.generate',
              )}
            </Text>
          </Button>
        </>
      )}
    </ScrollView>
  );
}
