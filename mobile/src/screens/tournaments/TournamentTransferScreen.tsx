import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { fileErrorKey } from '@/features/games/files';
import { tournamentErrorKey } from '@/features/tournaments/errors';
import {
  pickAndImportTournaments,
  saveTournamentsExport,
} from '@/features/tournaments/files';
import type {
  TournamentFormat,
  TournamentImportReport,
} from '@/features/tournaments/types';
import { useTranslation } from '@/i18n';
import { ApiError } from '@/lib/api';

export default function TournamentTransferScreen() {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const insets = useSafeAreaInsets();
  const [format, setFormat] = useState<TournamentFormat>('json');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [fileDetails, setFileDetails] = useState('');
  const [report, setReport] = useState<TournamentImportReport | null>(null);

  async function transfer(operation: 'import' | 'save' | 'share') {
    if (!token || user?.role !== 'admin' || busy) return;
    setBusy(true);
    setMessage('');
    setFileDetails('');
    setReport(null);
    try {
      if (operation === 'import')
        setReport(await pickAndImportTournaments(token));
      else {
        await saveTournamentsExport(
          token,
          format,
          operation === 'share',
          t('tournaments.transfer'),
        );
        setMessage(
          operation === 'share'
            ? 'tournaments.shareClosed'
            : 'tournaments.exportSaved',
        );
      }
    } catch (caught) {
      const fileKey = fileErrorKey(caught);
      setMessage(
        fileKey === 'games.transferCanceled'
          ? fileKey
          : (fileKey ?? tournamentErrorKey(caught)),
      );
      if (caught instanceof ApiError && caught.fileDetails)
        setFileDetails(caught.fileDetails);
    } finally {
      setBusy(false);
    }
  }

  function confirmImport() {
    Alert.alert(t('tournaments.confirmTitle'), t('tournaments.confirmImport'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        style: 'destructive',
        onPress: () => void transfer('import'),
      },
    ]);
  }

  if (user?.role !== 'admin')
    return <ScreenState error message={t('errors.forbidden')} />;
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 px-5 py-5"
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
      {message ? <FormMessage>{t(message)}</FormMessage> : null}
      {fileDetails ? <FormMessage>{fileDetails}</FormMessage> : null}
      {report ? (
        <FormMessage success>
          {t('tournaments.importResult', {
            created: report.created,
            updated: report.updated,
          })}
        </FormMessage>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{t('tournaments.import')}</CardTitle>
        </CardHeader>
        <CardContent className="gap-3">
          <Text variant="muted">{t('tournaments.importHint')}</Text>
          <Button disabled={busy} onPress={confirmImport}>
            <Text>{t('games.chooseFile')}</Text>
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('tournaments.export')}</CardTitle>
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
    </ScrollView>
  );
}
