import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Cancel01Icon from '@hugeicons/core-free-icons/Cancel01Icon';
import Mail01Icon from '@hugeicons/core-free-icons/Mail01Icon';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { useAuth } from '@/features/auth/session';
import { useTranslation } from '@/i18n';
import { listInvitations, type Invitation } from './api';

interface Activity {
  count: number;
  responses: number;
  notice: {
    id: string;
    message: string;
    direction: 'incoming' | 'outgoing';
  } | null;
  refresh: () => Promise<void>;
  acknowledge: () => void;
  dismiss: () => void;
}
const Context = createContext<Activity>({
  count: 0,
  responses: 0,
  notice: null,
  refresh: async () => {},
  acknowledge: () => {},
  dismiss: () => {},
});
export const useInvitationActivity = () => useContext(Context);

export function InvitationActivityProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  return user ? (
    <AccountActivity key={user.id} accountId={user.id}>
      {children}
    </AccountActivity>
  ) : (
    <Context.Provider
      value={{
        count: 0,
        responses: 0,
        notice: null,
        refresh: async () => {},
        acknowledge: () => {},
        dismiss: () => {},
      }}
    >
      {children}
    </Context.Provider>
  );
}

function AccountActivity({
  accountId,
  children,
}: PropsWithChildren<{ accountId: string }>) {
  const { token } = useAuth();
  const [count, setCount] = useState(0);
  const [responses, setResponses] = useState(0);
  const [notice, setNotice] = useState<Activity['notice']>(null);
  const readThrough = useRef(0);
  const latestStamp = useRef(0);
  const pendingCount = useRef(0);
  const dismissed = useRef('');
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const storageKey = `epickem.invitation-activity.${accountId}`;
  const refresh = useCallback(() => refreshRef.current(), []);
  const acknowledge = useCallback(() => {
    readThrough.current = latestStamp.current;
    setResponses(0);
    setCount(pendingCount.current);
    setNotice(null);
    void SecureStore.setItemAsync(
      storageKey,
      String(readThrough.current),
    ).catch(() => undefined);
  }, [storageKey]);
  const dismiss = useCallback(() => setNotice(null), []);

  useEffect(() => {
    let active = true;
    let loading = false;
    let ready = false;
    async function poll(force = false) {
      if (
        !active ||
        !ready ||
        loading ||
        !token ||
        (!force &&
          (AppState.currentState === 'background' ||
            AppState.currentState === 'inactive'))
      )
        return;
      loading = true;
      try {
        const incoming = await listInvitations(token, {
          direction: 'incoming',
          status: 'pending',
        });
        if (!active) return;
        const outgoing: Invitation[] = [];
        // Inspect every page: an older invitation can receive a new response.
        for (let offset = 0; active; offset += 20) {
          const page = await listInvitations(token, {
            direction: 'outgoing',
            offset,
          });
          if (!active) return;
          outgoing.push(...page.items);
          if (
            offset + page.items.length >= page.total ||
            page.items.length === 0
          )
            break;
        }
        if (!active) return;
        const replies = outgoing.filter(
          (item) =>
            (item.status === 'accepted' ||
              item.status === 'declined' ||
              (item.status === 'pending' && item.is_link && item.uses > 0)) &&
            Date.parse(item.updated_at) > readThrough.current,
        );
        const received = incoming.items.filter(
          (item) => Date.parse(item.created_at) > readThrough.current,
        );
        const all = [...received, ...replies].sort(
          (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
        );
        latestStamp.current = Math.max(
          readThrough.current,
          ...incoming.items.map((item) => Date.parse(item.updated_at)),
          ...outgoing.map((item) => Date.parse(item.updated_at)),
        );
        pendingCount.current = incoming.total;
        setResponses(replies.length);
        setCount(incoming.total + replies.length);
        const latest = all[0];
        if (latest) {
          const key = `${latest.id}:${latest.updated_at}`;
          if (key !== dismissed.current) {
            dismissed.current = key;
            const sent = latest.inviter_id === accountId;
            setNotice({
              id: latest.id,
              direction: sent ? 'outgoing' : 'incoming',
              message: sent
                ? latest.status === 'declined'
                  ? 'invitations.declinedNotice'
                  : 'invitations.acceptedNotice'
                : 'invitations.receivedNotice',
            });
          }
        } else setNotice(null);
      } catch {
        // Keep the last known count offline; retry on resume or the next interval.
      } finally {
        loading = false;
      }
    }
    refreshRef.current = () => poll(true);
    void SecureStore.getItemAsync(storageKey)
      .catch(() => null)
      .then((stored) => {
        if (!active) return;
        const parsed = Number(stored);
        readThrough.current = Number.isFinite(parsed) ? parsed : 0;
        ready = true;
        void poll();
      });
    const timer = setInterval(() => void poll(), 15_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void poll();
    });
    const notifications = Notifications.addNotificationReceivedListener(
      () => void poll(),
    );
    return () => {
      active = false;
      refreshRef.current = async () => {};
      clearInterval(timer);
      subscription.remove();
      notifications.remove();
    };
  }, [accountId, storageKey, token]);

  useEffect(() => {
    void Notifications.setBadgeCountAsync(count).catch(() => undefined);
    return () => {
      void Notifications.setBadgeCountAsync(0).catch(() => undefined);
    };
  }, [count]);

  return (
    <Context.Provider
      value={{ count, responses, notice, refresh, acknowledge, dismiss }}
    >
      {children}
    </Context.Provider>
  );
}

export function InvitationActivityBanner() {
  const { notice, dismiss } = useInvitationActivity();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  if (!notice) return null;
  return (
    <View
      className="absolute right-4 left-4 flex-row items-center gap-2 rounded-xl border border-primary bg-card p-3 shadow-md"
      style={{ bottom: insets.bottom + 76 }}
      accessibilityLiveRegion="polite"
    >
      <Button
        variant="ghost"
        className="flex-1 justify-start"
        onPress={() => {
          dismiss();
          router.push({
            pathname: '/invitations/[id]',
            params: { id: notice.id },
          });
        }}
      >
        <Icon icon={Mail01Icon} tone="primary" size={20} />
        <Text className="flex-1 text-left">{t(notice.message)}</Text>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        accessibilityLabel={t('invitations.dismiss')}
        onPress={dismiss}
      >
        <Icon icon={Cancel01Icon} size={18} />
      </Button>
    </View>
  );
}
