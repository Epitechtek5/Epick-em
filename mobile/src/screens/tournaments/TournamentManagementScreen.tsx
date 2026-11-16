import { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  assignTournamentRole,
  createTournamentFromTemplate,
  duplicateTournament,
  getTournament,
  inviteToTournament,
  listTournamentInvitations,
  listTournamentRoles,
  listTournamentTemplates,
  revokeTournamentRole,
  saveTournamentTemplate,
  transferTournamentOwnership,
  uninviteFromTournament,
} from '@/features/tournaments/api';
import { tournamentErrorKey } from '@/features/tournaments/errors';
import type { TournamentRole } from '@/features/tournaments/types';
import { getUser } from '@/features/users/api';
import { useTranslation } from '@/i18n';

export default function TournamentManagementScreen() {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<TournamentRole>('referee');
  const [copyName, setCopyName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    async (accessToken: string) => {
      const tournament = await getTournament(accessToken, tournamentId);
      const [roles, invitations, templates] = await Promise.all([
        listTournamentRoles(accessToken, tournamentId),
        tournament.visibility === 'invitation_only'
          ? listTournamentInvitations(accessToken, tournamentId)
          : Promise.resolve([]),
        user?.role === 'admin'
          ? listTournamentTemplates(accessToken)
          : Promise.resolve([]),
      ]);
      const ids = [
        ...new Set(
          [
            roles.owner_id,
            ...roles.roles.map((item) => item.user_id),
            ...invitations.map((item) => item.user_id),
          ].filter((id): id is string => Boolean(id)),
        ),
      ];
      const names = Object.fromEntries(
        await Promise.all(
          ids.map(async (id) => {
            try {
              return [id, (await getUser(accessToken, id)).username] as const;
            } catch {
              return [id, id] as const;
            }
          }),
        ),
      );
      return { tournament, roles, invitations, templates, names };
    },
    [tournamentId, user?.role],
  );
  const { data, loading, error, reload } = useGameResource(
    load,
    tournamentErrorKey,
  );

  async function mutate(operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await operation();
      await reload();
    } catch (caught) {
      setMessage(tournamentErrorKey(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!data)
    return (
      <ScreenState
        loading={loading}
        error={Boolean(error)}
        message={t(error || 'tournaments.loading')}
        onRetry={error ? () => void reload() : undefined}
      />
    );
  const isOwner = data.roles.owner_id === user?.id || user?.role === 'admin';

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-5"
    >
      {message ? <FormMessage>{t(message)}</FormMessage> : null}
      <Card>
        <CardContent className="gap-3 pt-5">
          <Text className="text-lg font-semibold">
            {t('tournaments.management.team')}
          </Text>
          <Text>
            {t('tournaments.management.owner')}:{' '}
            {data.roles.owner_id ? data.names[data.roles.owner_id] : '—'}
          </Text>
          {data.roles.roles.map((assignment) => (
            <View
              key={assignment.user_id}
              className="flex-row items-center gap-2"
            >
              <Text className="flex-1">
                {data.names[assignment.user_id]} ·{' '}
                {t(`tournaments.role.${assignment.role}`)}
              </Text>
              {isOwner ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onPress={() =>
                    token &&
                    void mutate(() =>
                      revokeTournamentRole(
                        token,
                        tournamentId,
                        assignment.user_id,
                      ),
                    )
                  }
                >
                  <Text>{t('common.delete')}</Text>
                </Button>
              ) : null}
            </View>
          ))}
          {isOwner ? (
            <>
              <Input
                accessibilityLabel={t('tournaments.management.userId')}
                placeholder={t('tournaments.management.userId')}
                value={userId}
                onChangeText={setUserId}
                autoCapitalize="none"
              />
              <View className="flex-row gap-2">
                {(['admin', 'referee'] as const).map((value) => (
                  <Button
                    key={value}
                    className="flex-1"
                    variant={role === value ? 'default' : 'outline'}
                    onPress={() => setRole(value)}
                  >
                    <Text>{t(`tournaments.role.${value}`)}</Text>
                  </Button>
                ))}
              </View>
              <Button
                disabled={busy || !userId}
                onPress={() =>
                  token &&
                  void mutate(() =>
                    assignTournamentRole(token, tournamentId, userId, role),
                  )
                }
              >
                <Text>{t('tournaments.management.assign')}</Text>
              </Button>
              <Button
                variant="outline"
                disabled={busy || !userId}
                onPress={() =>
                  Alert.alert(
                    t('tournaments.confirmTitle'),
                    t('tournaments.management.transferConfirm'),
                    [
                      { text: t('common.cancel'), style: 'cancel' },
                      {
                        text: t('common.confirm'),
                        onPress: () =>
                          token &&
                          void mutate(() =>
                            transferTournamentOwnership(
                              token,
                              tournamentId,
                              userId,
                            ),
                          ),
                      },
                    ],
                  )
                }
              >
                <Text>{t('tournaments.management.transfer')}</Text>
              </Button>
            </>
          ) : null}
        </CardContent>
      </Card>

      {data.tournament.visibility === 'invitation_only' && isOwner ? (
        <Card>
          <CardContent className="gap-3 pt-5">
            <Text className="text-lg font-semibold">
              {t('tournaments.management.invitations')}
            </Text>
            {data.invitations.map((invitation) => (
              <View
                key={invitation.user_id}
                className="flex-row items-center gap-2"
              >
                <Text className="flex-1">{data.names[invitation.user_id]}</Text>
                <Button
                  size="sm"
                  variant="destructive"
                  onPress={() =>
                    token &&
                    void mutate(() =>
                      uninviteFromTournament(
                        token,
                        tournamentId,
                        invitation.user_id,
                      ),
                    )
                  }
                >
                  <Text>{t('common.delete')}</Text>
                </Button>
              </View>
            ))}
            <Button
              disabled={busy || !userId}
              onPress={() =>
                token &&
                void mutate(() =>
                  inviteToTournament(token, tournamentId, userId),
                )
              }
            >
              <Text>{t('tournaments.management.invite')}</Text>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {user?.role === 'admin' ? (
        <Card>
          <CardContent className="gap-3 pt-5">
            <Text className="text-lg font-semibold">
              {t('tournaments.management.reuse')}
            </Text>
            <Input
              accessibilityLabel={t('tournaments.fields.name')}
              placeholder={t('tournaments.management.copyName')}
              value={copyName}
              onChangeText={setCopyName}
            />
            <Button
              disabled={busy || !copyName.trim()}
              onPress={() =>
                token &&
                void mutate(async () => {
                  const result = await duplicateTournament(
                    token,
                    tournamentId,
                    { name: copyName.trim() },
                  );
                  router.push({
                    pathname: '/(authenticated)/tournaments/[tournamentId]',
                    params: { tournamentId: result.id },
                  });
                })
              }
            >
              <Text>{t('tournaments.management.duplicate')}</Text>
            </Button>
            <Button
              variant="outline"
              disabled={busy || !copyName.trim()}
              onPress={() =>
                token &&
                void mutate(() =>
                  saveTournamentTemplate(token, tournamentId, {
                    name: copyName.trim(),
                  }),
                )
              }
            >
              <Text>{t('tournaments.management.saveTemplate')}</Text>
            </Button>
            {data.templates.map((template) => (
              <Button
                key={template.id}
                variant="outline"
                disabled={busy || !copyName.trim()}
                onPress={() =>
                  token &&
                  void mutate(async () => {
                    const result = await createTournamentFromTemplate(
                      token,
                      template.id,
                      { name: copyName.trim() },
                    );
                    router.push({
                      pathname: '/(authenticated)/tournaments/[tournamentId]',
                      params: { tournamentId: result.id },
                    });
                  })
                }
              >
                <Text>
                  {t('tournaments.management.useTemplate', {
                    name: template.name,
                  })}
                </Text>
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </ScrollView>
  );
}
