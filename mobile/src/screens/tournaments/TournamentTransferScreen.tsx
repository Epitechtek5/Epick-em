import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import { ImportPreviewDetails } from '@/components/tournaments/ImportPreviewDetails';
import { useAuth } from '@/features/auth/session';
import { fileErrorKey } from '@/features/games/files';
import { tournamentErrorKey } from '@/features/tournaments/errors';
import { saveTournamentsExport } from '@/features/tournaments/files';
import { useImportPreview } from '@/features/tournaments/use-import-preview';
import type { TournamentFormat } from '@/features/tournaments/types';
import { useTranslation } from '@/i18n';

export default function TournamentTransferScreen() {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  if (!token || user?.role !== 'admin')
    return <ScreenState error message={t('errors.forbidden')} />;
  // Account changes remount the workflow and invalidate pending requests/files.
  return <TournamentTransfer key={user.id} token={token} />;
}

function TournamentTransfer({ token }: { token: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const flow = useImportPreview(token);
  const [format, setFormat] = useState<TournamentFormat>('json');
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const exportLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function exportFile(share: boolean) {
    if (exportLock.current || flow.busy) return;
    exportLock.current = true;
    setExporting(true);
    setMessage('');
    try {
      await saveTournamentsExport(
        token,
        format,
        share,
        t('tournaments.transfer'),
      );
      if (mounted.current)
        setMessage(
          share ? 'tournaments.shareClosed' : 'tournaments.exportSaved',
        );
    } catch (caught) {
      if (mounted.current)
        setMessage(fileErrorKey(caught) ?? tournamentErrorKey(caught));
    } finally {
      exportLock.current = false;
      if (mounted.current) setExporting(false);
    }
  }

  const valid = flow.preview?.valid && flow.preview.errors.length === 0;
  const initial = flow.stage === 'file';
  const needsNewPreview = ['stale', 'expired', 'error'].includes(flow.stage);
  const statusKey =
    flow.stage === 'error' ? flow.error : `importPreview.states.${flow.stage}`;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 px-5 py-5"
      contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
    >
      <Text variant="h3">
        {t(
          initial
            ? 'tournaments.import'
            : flow.stage === 'success'
              ? 'importPreview.success'
              : 'importPreview.title',
        )}
      </Text>
      {initial ? <Text variant="muted">{t('importPreview.intro')}</Text> : null}
      {flow.file ? (
        <View className="gap-1 rounded-xl border border-border p-4">
          <Text className="font-medium">{flow.file.name}</Text>
          <Text variant="muted">
            {t('importPreview.fileInfo', {
              format: flow.file.format.toUpperCase(),
              size: Math.ceil(flow.file.bytes.byteLength / 1024),
            })}
          </Text>
        </View>
      ) : null}
      {flow.busy ? (
        <View accessibilityLiveRegion="polite" className="gap-3 py-4">
          <ActivityIndicator accessibilityLabel={t(statusKey)} />
          <Text className="text-center">{t(statusKey)}</Text>
        </View>
      ) : !initial && flow.stage !== 'success' && flow.stage !== 'preview' ? (
        <FormMessage>{t(statusKey)}</FormMessage>
      ) : null}
      {flow.stage === 'preview' && flow.preview ? (
        <>
          <Text variant="muted">{t('importPreview.readOnly')}</Text>
          {valid ? (
            <Text variant="muted">
              {t('importPreview.expires', {
                minutes: Math.floor((flow.preview.expires_in ?? 0) / 60),
              })}
            </Text>
          ) : null}
          {flow.preview.requires_confirmation ? (
            <FormMessage>{t('importPreview.destructive')}</FormMessage>
          ) : null}
          <ImportPreviewDetails
            key={flow.preview.preview_id ?? 'invalid'}
            preview={flow.preview}
          />
          {valid && flow.preview.requires_confirmation ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={t('importPreview.consent')}
              accessibilityState={{ checked: flow.consent }}
              onPress={() => flow.setConsent(!flow.consent)}
              className="min-h-12 flex-row items-center gap-3 rounded-xl border border-border p-4"
            >
              <Text
                className="text-xl text-primary"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {flow.consent ? '☑' : '☐'}
              </Text>
              <Text className="flex-1 text-sm">
                {t('importPreview.consent')}
              </Text>
            </Pressable>
          ) : null}
          {valid ? (
            <Button
              disabled={
                !flow.preview.preview_id ||
                (flow.preview.requires_confirmation && !flow.consent)
              }
              onPress={() => void flow.confirm()}
            >
              <Text>{t('importPreview.confirm')}</Text>
            </Button>
          ) : (
            <Text accessibilityRole="alert">{t('importPreview.invalid')}</Text>
          )}
          <Button variant="outline" onPress={() => void flow.choose()}>
            <Text>{t('importPreview.changeFile')}</Text>
          </Button>
          <Button variant="ghost" onPress={flow.cancel}>
            <Text>{t('common.cancel')}</Text>
          </Button>
        </>
      ) : null}
      {needsNewPreview ? (
        <>
          {flow.file ? (
            <Button onPress={() => void flow.refresh()}>
              <Text>{t('importPreview.refresh')}</Text>
            </Button>
          ) : null}
          <Button variant="outline" onPress={() => void flow.choose()}>
            <Text>{t('importPreview.changeFile')}</Text>
          </Button>
          <Button variant="ghost" onPress={flow.cancel}>
            <Text>{t('common.cancel')}</Text>
          </Button>
        </>
      ) : null}
      {flow.stage === 'success' && flow.report ? (
        <FormMessage success>
          {t('tournaments.importResult', { ...flow.report })}
        </FormMessage>
      ) : null}
      {flow.stage === 'unknown' || flow.stage === 'success' ? (
        <>
          <Button
            onPress={() => router.replace('/(authenticated)/tournaments')}
          >
            <Text>
              {t(
                flow.stage === 'unknown'
                  ? 'importPreview.verify'
                  : 'importPreview.view',
              )}
            </Text>
          </Button>
          <Button variant="outline" onPress={flow.cancel}>
            <Text>{t('tournaments.transfer')}</Text>
          </Button>
        </>
      ) : null}
      {initial ? (
        <>
          <Card>
            <CardContent className="gap-4 pt-6">
              <Text variant="muted">{t('tournaments.importHint')}</Text>
              <Button disabled={exporting} onPress={() => void flow.choose()}>
                <Text>{t('games.chooseFile')}</Text>
              </Button>
              <Text variant="muted">{t('importPreview.readOnly')}</Text>
            </CardContent>
          </Card>
          {message ? <FormMessage>{t(message)}</FormMessage> : null}
          <Card>
            <CardHeader>
              <CardTitle>{t('tournaments.export')}</CardTitle>
            </CardHeader>
            <CardContent className="gap-3">
              <View className="flex-row gap-2">
                {(['json', 'csv'] as const).map((choice) => (
                  <Button
                    key={choice}
                    disabled={exporting}
                    variant={format === choice ? 'default' : 'outline'}
                    onPress={() => setFormat(choice)}
                  >
                    <Text>{choice.toUpperCase()}</Text>
                  </Button>
                ))}
              </View>
              <Button
                disabled={exporting}
                variant="outline"
                onPress={() => void exportFile(false)}
              >
                <Text>{t('games.saveFile')}</Text>
              </Button>
              <Button
                disabled={exporting}
                variant="outline"
                onPress={() => void exportFile(true)}
              >
                <Text>{t('games.shareFile')}</Text>
              </Button>
            </CardContent>
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}
