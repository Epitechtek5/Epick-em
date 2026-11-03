import { useEffect, useState } from 'react';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { getUser } from '@/features/users/api';

export function UserName({ id, label }: { id: string; label?: string }) {
  const { token } = useAuth();
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void getUser(token, id)
      .then((user) => {
        if (active) setUsername(user.username);
      })
      .catch(() => {
        if (active) setUsername(null);
      });
    return () => {
      active = false;
    };
  }, [id, token]);

  return (
    <Text variant="muted" numberOfLines={1}>
      {label ? `${label}: ` : ''}
      {username ?? id}
    </Text>
  );
}
