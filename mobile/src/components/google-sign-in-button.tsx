import { useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { FormMessage } from '@/components/ui/feedback';
import { useAuth } from '@/features/auth/session';
import { startGoogle, securityError } from '@/features/auth/google';
import { useTranslation } from '@/i18n';

export function GoogleSignInButton({
  disabled = false,
  linking = false,
}: {
  disabled?: boolean;
  linking?: boolean;
}) {
  const { t } = useTranslation();
  const { user, clearSession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (!linking) await clearSession();
      const callback = await startGoogle(linking ? (user?.id ?? null) : null);
      if (callback)
        router.replace({
          pathname: '/auth/google/callback',
          params: { callback },
        });
    } catch (caught) {
      setError(securityError(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View className="gap-2">
      <Button
        disabled={disabled || busy}
        onPress={() => void start()}
        accessibilityLabel={t(
          linking ? 'security.linkGoogle' : 'security.google',
        )}
      >
        <View
          className="h-7 w-7 items-center justify-center rounded-full bg-white"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Svg width={20} height={20} viewBox="0 0 48 48">
            <Path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
            />
            <Path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.04 46.98 31.88 46.98 24.55Z"
            />
            <Path
              fill="#FBBC05"
              d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19Z"
            />
            <Path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
            />
          </Svg>
        </View>
        <Text>
          {t(
            busy
              ? 'common.loading'
              : linking
                ? 'security.linkGoogle'
                : 'security.google',
          )}
        </Text>
      </Button>
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
    </View>
  );
}
