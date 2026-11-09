import type { ReactNode } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenState } from '@/components/ui/feedback';
import { useTranslation } from '@/i18n';
export function MatchPage({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-background"
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="gap-4 px-5 py-5"
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
    >
      {children}
    </ScrollView>
  );
}
export function MatchState({
  error,
  loading,
  reload,
}: {
  error: string;
  loading: boolean;
  reload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <ScreenState
      loading={loading}
      error={!!error}
      message={t(error || 'steps.loading')}
      onRetry={error ? () => void reload() : undefined}
    />
  );
}
