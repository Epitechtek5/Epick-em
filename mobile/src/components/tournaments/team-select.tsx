import { useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import type { TournamentTeam } from '@/features/teams/types';
import { useTranslation } from '@/i18n';

export function TournamentTeamSelect({
  teams,
  selectedId,
  onSelect,
  page,
  hasNext,
  onPageChange,
  disabledIds = new Set(),
  descriptions = {},
  allowNoTeam = true,
}: {
  teams: TournamentTeam[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  page: number;
  hasNext: boolean;
  onPageChange: (page: number) => void;
  disabledIds?: ReadonlySet<string>;
  descriptions?: Record<string, string>;
  allowNoTeam?: boolean;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = teams.find((team) => team.id === selectedId);
  const filtered = teams.filter((team) =>
    team.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <View className="gap-2">
      <Text className="font-medium">{t('tournaments.fields.team')}</Text>
      <Button
        variant="outline"
        accessibilityLabel={t('tournaments.selectTeam')}
        onPress={() => {
          setSearch('');
          setOpen(true);
        }}
      >
        <Text>
          {selected?.name ?? selectedId ?? t('tournaments.chooseTeam')}
        </Text>
      </Button>
      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <KeyboardAvoidingView
          className="flex-1 bg-background"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View
            className="flex-1 gap-3 px-5 pt-5"
            style={{ paddingBottom: insets.bottom + 20 }}
          >
            <Text className="text-xl font-semibold">
              {t('tournaments.selectTeam')}
            </Text>
            <Input
              accessibilityLabel={t('tournaments.searchTeams')}
              placeholder={t('tournaments.searchTeams')}
              value={search}
              onChangeText={setSearch}
            />
            <FlatList
              data={filtered}
              keyExtractor={(team) => team.id}
              keyboardShouldPersistTaps="handled"
              contentContainerClassName="gap-2"
              ListEmptyComponent={
                <Text variant="muted">{t('tournaments.noTeams')}</Text>
              }
              renderItem={({ item }) => (
                <Button
                  variant={item.id === selectedId ? 'default' : 'outline'}
                  disabled={disabledIds.has(item.id)}
                  onPress={() => {
                    onSelect(item.id);
                    setOpen(false);
                  }}
                >
                  <View className="flex-1 gap-1">
                    <Text>{item.name}</Text>
                    {descriptions[item.id] ? (
                      <Text className="text-xs" variant="muted">
                        {descriptions[item.id]}
                      </Text>
                    ) : null}
                  </View>
                </Button>
              )}
            />
            <View className="flex-row items-center justify-between gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onPress={() => onPageChange(page - 1)}
              >
                <Text>{t('users.previous')}</Text>
              </Button>
              <Text variant="muted">{t('users.page', { page: page + 1 })}</Text>
              <Button
                size="sm"
                variant="outline"
                disabled={!hasNext}
                onPress={() => onPageChange(page + 1)}
              >
                <Text>{t('users.next')}</Text>
              </Button>
            </View>
            <View className="flex-row gap-2">
              {allowNoTeam ? (
                <Button
                  className="flex-1"
                  variant="outline"
                  onPress={() => {
                    onSelect(null);
                    setOpen(false);
                  }}
                >
                  <Text>{t('tournaments.noTeam')}</Text>
                </Button>
              ) : null}
              <Button className="flex-1" onPress={() => setOpen(false)}>
                <Text>{t('common.cancel')}</Text>
              </Button>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
