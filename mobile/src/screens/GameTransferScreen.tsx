import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import Upload04Icon from '@hugeicons/core-free-icons/Upload04Icon';
import Download04Icon from '@hugeicons/core-free-icons/Download04Icon';
import Share08Icon from '@hugeicons/core-free-icons/Share08Icon';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { FormMessage } from '@/components/ui/feedback';
import { GameAdminGuard } from '@/components/games/game-admin-guard';
import { useAuth } from '@/features/auth/session';
import {
  fileErrorKey,
  pickAndImportGames,
  saveGamesExport,
} from '@/features/games/files';
import { gameErrorKey } from '@/features/games/errors';
import type { GameFormat, ImportReport } from '@/features/games/types';
import { useTranslation } from '@/i18n';

function Transfers() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { token, user, refreshUser } = useAuth();
  const [format, setFormat] = useState<GameFormat>('json');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const pending = useRef(false);

  async function transfer(operation: 'import' | 'save' | 'share') {
    if (!token || user?.role !== 'admin' || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    setReport(null);
    try {
      if (operation === 'import') {
        setReport(await pickAndImportGames(token));
      } else {
        await saveGamesExport(
          token,
          format,
          operation === 'share',
          t('games.export'),
        );
        // Sharing resolves on dismissal too: do not claim that the recipient saved the file.
        setMessage(
          operation === 'share' ? 'games.shareClosed' : 'games.exportSaved',
        );
      }
    } catch (caught) {
      const fileKey = fileErrorKey(caught);
      if (fileKey === 'games.transferCanceled') setMessage(fileKey);
      else setError(fileKey || gameErrorKey(caught));
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
          <CardTitle>{t('games.import')}</CardTitle>
          <CardDescription>{t('games.importHint')}</CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          <Text variant="muted">{t('games.statsHint')}</Text>
          <Button disabled={busy} onPress={() => void transfer('import')}>
            <Icon icon={Upload04Icon} tone="primary-foreground" />
            <Text>{t('games.chooseFile')}</Text>
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('games.export')}</CardTitle>
          <CardDescription>{t('games.exportHint')}</CardDescription>
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
            <Icon icon={Download04Icon} />
            <Text>{t('games.saveFile')}</Text>
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onPress={() => void transfer('share')}
          >
            <Icon icon={Share08Icon} />
            <Text>{t('games.shareFile')}</Text>
          </Button>
        </CardContent>
      </Card>
      {busy ? (
        <ActivityIndicator accessibilityLabel={t('games.transferring')} />
      ) : null}
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
      {message ? <FormMessage success>{t(message)}</FormMessage> : null}
      {report ? (
        <View className="gap-3">
          <FormMessage success>
            {t('games.importResult', {
              created: report.created,
              updated: report.updated,
            })}
          </FormMessage>
          <Button
            onPress={() => router.replace('/(authenticated)/(tabs)/games')}
          >
            <Text>{t('games.returnToCatalog')}</Text>
          </Button>
        </View>
      ) : null}
    </ScrollView>
  );
}

export default function GameTransferScreen() {
  return (
    <GameAdminGuard>
      <Transfers />
    </GameAdminGuard>
  );
}
