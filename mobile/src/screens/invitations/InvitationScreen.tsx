import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ArrowLeft01Icon from '@hugeicons/core-free-icons/ArrowLeft01Icon';
import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import { StatusBadge } from '@/components/ui/status-badge';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  acceptInvitationLink,
  actOnInvitation,
  getInvitation,
  invitationErrorKey,
  invitationNames,
  resolveInvitationLink,
  type InvitationAction,
} from '@/features/invitations/api';
import {
  invitationTarget,
  resourceTarget,
  useInvitationLifetime,
  useInvitationReturn,
} from '@/features/invitations/navigation';
import { useTranslation } from '@/i18n';
import { useInvitationActivity } from '@/features/invitations/activity';

export default function InvitationScreen() {
  const { id, token: secret } = useLocalSearchParams<{
    id?: string;
    token?: string;
  }>();
  const { user, initializing } = useAuth();
  const { remember } = useInvitationReturn();
  const { t } = useTranslation();
  const path = secret ? `/invite/${secret}` : `/invitations/${id}`;
  const target = invitationTarget(path);
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-row items-center gap-3 px-5 py-3">
        <Button
          variant="outline"
          size="icon"
          accessibilityLabel={t('common.back')}
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : user
                ? router.replace('/(authenticated)/(tabs)/invitations')
                : router.replace('/login')
          }
        >
          <Icon icon={ArrowLeft01Icon} size={20} />
        </Button>
        <Text className="text-lg font-semibold">
          {t('invitations.details')}
        </Text>
      </View>
      {initializing ? (
        <ScreenState loading message={t('common.restoring')} />
      ) : !target ? (
        <ScreenState error message={t('invitations.errors.unavailable')} />
      ) : !user ? (
        <View className="gap-5 px-5 py-8">
          <Text variant="h3">{t('invitations.loginTitle')}</Text>
          <Text variant="muted">{t('invitations.loginDescription')}</Text>
          <Button
            onPress={() => {
              remember(path);
              router.push('/login');
            }}
          >
            <Text>{t('login.title')}</Text>
          </Button>
          <Button
            variant="outline"
            onPress={() => {
              remember(path);
              router.push('/register');
            }}
          >
            <Text>{t('register.title')}</Text>
          </Button>
        </View>
      ) : (
        <Details key={`${user.id}:${path}`} id={id} secret={secret} />
      )}
    </View>
  );
}
function Details({ id, secret }: { id?: string; secret?: string }) {
  const activity = useInvitationActivity();
  const { t, i18n } = useTranslation();
  const { user, token } = useAuth();
  const { clear } = useInvitationReturn();
  useEffect(() => {
    clear();
  }, [clear]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const active = useInvitationLifetime();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [accepted, setAccepted] = useState<ReturnType<
    typeof resourceTarget
  > | null>(null);
  const load = useCallback(
    async (accessToken: string) => {
      if (secret)
        return {
          invitation: null,
          preview: await resolveInvitationLink(accessToken, secret),
        };
      const invitation = await getInvitation(accessToken, id ?? '');
      const names = await invitationNames(accessToken, invitation);
      return {
        invitation,
        preview: {
          type: invitation.type,
          role: invitation.role,
          expires_at: invitation.expires_at,
          resource_name: names.resource,
          inviter_username: names.inviter,
        },
      };
    },
    [id, secret],
  );
  const state = useGameResource(load, invitationErrorKey);
  const invitation = state.data?.invitation;
  const preview = state.data?.preview;
  const pending =
    !accepted &&
    preview &&
    new Date(preview.expires_at).getTime() > now &&
    (!invitation || invitation.status === 'pending');
  const recipient = invitation?.recipient_id === user?.id;
  const displayStatus = accepted
    ? 'accepted'
    : invitation?.status === 'pending' && !pending
      ? 'expired'
      : (invitation?.status ?? (pending ? 'pending' : 'expired'));
  const canManage =
    invitation &&
    (invitation.inviter_id === user?.id || user?.role === 'admin');
  const destination =
    accepted ??
    (invitation?.status === 'accepted'
      ? resourceTarget(invitation.type, invitation.resource_id)
      : null);
  async function perform(action: InvitationAction) {
    if (!active.current || !token || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = secret
        ? await acceptInvitationLink(token, secret)
        : await actOnInvitation(token, id ?? '', action);
      if (!active.current) return;
      activity.dismiss();
      void activity.refresh();
      clear();
      if (action === 'accept') {
        setAccepted(resourceTarget(result.type, result.resource_id));
        setMessage(
          result.type === 'tournament'
            ? 'invitations.acceptedTournament'
            : 'invitations.acceptedTeam',
        );
      } else {
        setMessage(`invitations.messages.${action}`);
        await state.reload();
      }
    } catch (caught) {
      if (active.current) {
        setError(invitationErrorKey(caught));
        await state.reload();
      }
    } finally {
      if (active.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  function confirm(action: 'decline' | 'revoke') {
    Alert.alert(
      t(`invitations.${action}`),
      t(`invitations.confirm.${action}`),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t(`invitations.${action}`),
          style: 'destructive',
          onPress: () => void perform(action),
        },
      ],
    );
  }
  if ((state.loading && !preview) || state.error || !preview)
    return (
      <ScreenState
        loading={state.loading}
        error={Boolean(state.error)}
        message={t(state.error || 'common.loading')}
        onRetry={() => void state.reload()}
      />
    );
  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-5 px-5 py-5">
      <Card className="gap-4 p-5">
        <Text variant="h3">
          {preview.resource_name ?? t('invitations.resourceUnavailable')}
        </Text>
        <Text variant="muted">{t(`invitations.types.${preview.type}`)}</Text>
        <StatusBadge
          status={displayStatus}
          label={t(`invitations.statuses.${displayStatus}`)}
        />
        {preview.inviter_username ? (
          <Text>
            {t('invitations.from', { name: preview.inviter_username })}
          </Text>
        ) : null}
        {preview.role ? (
          <Text>
            {t('invitations.role')}: {t(`teams.roles.${preview.role}`)}
          </Text>
        ) : null}
        <Text variant="muted">
          {t('invitations.expires', {
            date: new Date(preview.expires_at).toLocaleString(i18n.language),
          })}
        </Text>
        {invitation?.is_link ? (
          <Text variant="muted">
            {t('invitations.usage', {
              used: invitation.uses,
              max: invitation.max_uses,
            })}
          </Text>
        ) : null}
      </Card>
      {preview.type === 'tournament' ? (
        <Text variant="muted">{t('invitations.tournamentPolicy')}</Text>
      ) : null}
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
      {message ? (
        <Text accessibilityLiveRegion="polite">{t(message)}</Text>
      ) : null}
      {destination ? (
        <Button onPress={() => router.replace(destination)}>
          <Text>
            {t(
              preview.type === 'tournament'
                ? 'invitations.openTournament'
                : 'invitations.openTeam',
            )}
          </Text>
        </Button>
      ) : null}
      {pending && (secret || recipient) ? (
        <Button disabled={busy} onPress={() => void perform('accept')}>
          <Text>{t(busy ? 'common.loading' : 'invitations.accept')}</Text>
        </Button>
      ) : null}
      {pending && recipient && !secret ? (
        <Button
          variant="outline"
          disabled={busy}
          onPress={() => confirm('decline')}
        >
          <Text>{t('invitations.decline')}</Text>
        </Button>
      ) : null}
      {pending && canManage ? (
        <>
          {!invitation.is_link && invitation.inviter_id === user?.id ? (
            <Button disabled={busy} onPress={() => void perform('resend')}>
              <Text>{t('invitations.resend')}</Text>
            </Button>
          ) : invitation.is_link ? (
            <Text variant="muted">{t('invitations.secretUnavailable')}</Text>
          ) : null}
          <Button
            variant="outline"
            disabled={busy}
            onPress={() => confirm('revoke')}
          >
            <Text className="text-destructive">{t('invitations.revoke')}</Text>
          </Button>
        </>
      ) : null}
    </ScrollView>
  );
}
