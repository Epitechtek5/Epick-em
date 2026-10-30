import type { PropsWithChildren } from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '@/features/auth/session';
import { ScreenState } from '@/components/ui/feedback';
import { useTranslation } from '@/i18n';

export function GameAdminGuard({ children }: PropsWithChildren) {
  const { user, initializing } = useAuth();
  const { t } = useTranslation();
  if (initializing)
    return <ScreenState loading message={t('common.restoring')} />;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== 'admin')
    return <Redirect href="/(authenticated)/(tabs)/games" />;
  return children;
}
