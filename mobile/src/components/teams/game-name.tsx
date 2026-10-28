import { useEffect, useState } from 'react';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { getGame } from '@/features/games/api';
import { useTranslation } from '@/i18n';

export function GameName({ id }: { id: string }) {
  const { t } = useTranslation();
  const { token } = useAuth();
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void getGame(token, id)
      .then((game) => {
        if (active) setName(game.name);
      })
      .catch(() => {
        if (active) setName(null);
      });
    return () => {
      active = false;
    };
  }, [id, token]);

  return (
    <Text variant="muted" numberOfLines={1}>
      {name ?? t('teams.gameUnavailable')}
    </Text>
  );
}
