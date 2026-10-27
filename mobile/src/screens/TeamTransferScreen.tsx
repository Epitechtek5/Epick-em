import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { fileErrorKey } from '@/features/games/files';
import { pickAndImportTeams, saveTeamsExport } from '@/features/teams/files';
import { teamErrorMessage } from '@/features/teams/errors';
import type { TeamFormat, TeamImportReport } from '@/features/teams/types';
import { useTranslation } from '@/i18n';

export default function TeamTransferScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const [format, setFormat] = useState<TeamFormat>('json');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [report, setReport] = useState<TeamImportReport | null>(null);

  if (user?.role !== 'admin')
    return <ScreenState error message={t('errors.forbidden')} />;

  async function transfer(operation: 'import' | 'save' | 'share') {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (operation === 'import') {
        setReport(await pickAndImportTeams(token));
      } else {
        await saveTeamsExport(
          token,
          format,
          operation === 'share',
          t('teams.transfer'),
        );
        setMessage(
          t(operation === 'share' ? 'teams.shareClosed' : 'teams.exportSaved'),
        );
      }
    } catch (caught) {
      const fileKey = fileErrorKey(caught);
      if (fileKey === 'games.transferCanceled') {
        setMessage(t('games.transferCanceled'));
      } else {
        setError(fileKey ? t(fileKey) : teamErrorMessage(caught, t));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-5 px-5 py-5"
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t('teams.import')}</CardTitle>
          <CardDescription>{t('teams.importHint')}</CardDescription>
        </CardHeader>
        <CardContent className="gap-3">
          <Button disabled={busy} onPress={() => void transfer('import')}>
            <Text>{t('games.chooseFile')}</Text>
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('teams.export')}</CardTitle>
          <CardDescription>{t('teams.exportHint')}</CardDescription>
        </CardHeader>
        <CardContent className="gap-3">
          <View className="flex-row gap-2">
            {(['json', 'csv'] as const).map((choice) => (
              <Button
                key={choice}
                variant={format === choice ? 'default' : 'outline'}
                onPress={() => setFormat(choice)}
              >
                <Text>{choice.toUpperCase()}</Text>
              </Button>
            ))}
          </View>
          <Button
            disabled={busy}
            variant="outline"
            onPress={() => void transfer('save')}
          >
            <Text>{t('games.saveFile')}</Text>
          </Button>
          <Button
            disabled={busy}
            variant="outline"
            onPress={() => void transfer('share')}
          >
            <Text>{t('games.shareFile')}</Text>
          </Button>
        </CardContent>
      </Card>
      {busy ? (
        <ActivityIndicator accessibilityLabel={t('games.transferring')} />
      ) : null}
      {error ? <FormMessage>{error}</FormMessage> : null}
      {message ? <FormMessage success>{message}</FormMessage> : null}
      {report ? (
        <View className="gap-3">
          <FormMessage success>
            {t('teams.importResult', {
              created: report.created,
              updated: report.updated,
            })}
          </FormMessage>
          <Button
            onPress={() => router.replace('/(authenticated)/(tabs)/teams')}
          >
            <Text>{t('teams.returnToCatalog')}</Text>
          </Button>
        </View>
      ) : null}
    </ScrollView>
  );
}
