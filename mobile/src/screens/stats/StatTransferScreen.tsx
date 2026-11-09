import { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GameAdminGuard } from '@/components/games/game-admin-guard';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FormMessage } from '@/components/ui/feedback';
import { useAuth } from '@/features/auth/session';
import { fileErrorKey } from '@/features/games/files';
import { statErrorKey } from '@/features/stats/errors';
import { pickAndImportStats, saveStatsExport } from '@/features/stats/files';
import type { StatFormat, StatImportReport } from '@/features/stats/types';
import { ApiError } from '@/lib/api';
import { useTranslation } from '@/i18n';

function Transfers() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { token, user, refreshUser } = useAuth();
  const [format, setFormat] = useState<StatFormat>('json');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileDetails, setFileDetails] = useState('');
  const [message, setMessage] = useState('');
  const [report, setReport] = useState<StatImportReport | null>(null);
  const pending = useRef(false);

  async function transfer(operation: 'import' | 'save' | 'share') {
    if (!token || user?.role !== 'admin' || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setFileDetails('');
    setMessage('');
    setReport(null);
    try {
      if (operation === 'import') {
        setReport(await pickAndImportStats(token));
      } else {
        await saveStatsExport(
          token,
          format,
          operation === 'share',
          t('stats.export'),
        );
        setMessage(
          operation === 'share' ? 'stats.shareClosed' : 'stats.exportSaved',
        );
      }
    } catch (caught) {
      const fileKey = fileErrorKey(caught);
      if (fileKey === 'games.transferCanceled') {
        setMessage('stats.transferCanceled');
      } else {
        setError(fileKey || statErrorKey(caught));
        if (caught instanceof ApiError) {
          setFileDetails(caught.fileDetails ?? '');
        }
      }
      void refreshUser().catch(() => undefined);
    } finally {
      pending.current = false;
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
          <CardTitle>{t('stats.import')}</CardTitle>
          <CardDescription>{t('stats.importHint')}</CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          <Button disabled={busy} onPress={() => void transfer('import')}>
            <Text>{t('stats.chooseFile')}</Text>
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('stats.export')}</CardTitle>
          <CardDescription>{t('stats.exportHint')}</CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          <View className="flex-row flex-wrap gap-3">
            {(['json', 'csv'] as const).map((value) => (
              <Button
                key={value}
                variant={value === format ? 'default' : 'outline'}
                accessibilityRole="radio"
                accessibilityState={{ checked: value === format }}
                disabled={busy}
                onPress={() => setFormat(value)}
              >
                <Text>{value.toUpperCase()}</Text>
              </Button>
            ))}
          </View>
          <Button
            variant="outline"
            disabled={busy}
            onPress={() => void transfer('save')}
          >
            <Text>{t('stats.saveFile')}</Text>
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onPress={() => void transfer('share')}
          >
            <Text>{t('stats.shareFile')}</Text>
          </Button>
        </CardContent>
      </Card>
      {busy ? (
        <ActivityIndicator accessibilityLabel={t('stats.transferring')} />
      ) : null}
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
      {fileDetails ? <FormMessage>{fileDetails}</FormMessage> : null}
      {message ? <FormMessage success>{t(message)}</FormMessage> : null}
      {report ? (
        <View className="gap-3">
          <FormMessage success>
            {t('stats.importResult', {
              created: report.created,
              updated: report.updated,
            })}
          </FormMessage>
          <Button onPress={() => router.replace('/(authenticated)/stats')}>
            <Text>{t('stats.returnToCatalog')}</Text>
          </Button>
        </View>
      ) : null}
    </ScrollView>
  );
}

export default function StatTransferScreen() {
  return (
    <GameAdminGuard>
      <Transfers />
    </GameAdminGuard>
  );
}
