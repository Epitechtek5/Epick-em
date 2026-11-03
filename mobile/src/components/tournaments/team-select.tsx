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
import { TeamImage } from '@/components/teams/team-image';
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
        className="min-h-16 justify-start border-primary/20 px-3 py-2"
        accessibilityLabel={t('tournaments.selectTeam')}
        onPress={() => {
          setSearch('');
          setOpen(true);
        }}
      >
        {selected ? (
          <TeamImage
            uri={selected.picture_url}
            name={selected.name}
            size="sm"
          />
        ) : null}
        <View className="min-w-0 flex-1 items-start gap-0.5">
          <Text className={selected ? 'font-semibold' : 'text-muted-foreground'}>
            {selected?.name ?? selectedId ?? t('tournaments.chooseTeam')}
          </Text>
          {selected?.tag ? (
            <Text className="text-xs text-primary">#{selected.tag}</Text>
          ) : null}
        </View>
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
            style={{
              paddingTop: insets.top + 20,
              paddingBottom: insets.bottom + 20,
            }}
          >
            <View className="gap-1">
              <Text className="text-xl font-semibold">
                {t('tournaments.registration.chooseTeamTitle')}
              </Text>
              <Text variant="muted">{t('tournaments.selectTeam')}</Text>
            </View>
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
              contentContainerClassName="gap-3 py-1"
              ListEmptyComponent={
                <View className="rounded-xl bg-muted/40 px-6 py-10">
                  <Text className="text-center" variant="muted">
                    {t('tournaments.noTeams')}
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <Button
                  className={`min-h-20 justify-start px-4 py-3 ${
                    item.id === selectedId
                      ? 'bg-primary/10'
                      : 'bg-muted/40'
                  }`}
                  variant="ghost"
                  disabled={disabledIds.has(item.id)}
                  onPress={() => {
                    onSelect(item.id);
                    setOpen(false);
                  }}
                >
                  <TeamImage uri={item.picture_url} name={item.name} size="sm" />
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="font-semibold">{item.name}</Text>
                    {item.tag ? (
                      <Text className="text-xs text-primary">#{item.tag}</Text>
                    ) : null}
                    {descriptions[item.id] ? (
                      <Text className="text-xs leading-4" variant="muted">
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
            <View className="gap-2">
              {allowNoTeam ? (
                <Button
                  className="w-full"
                  variant="outline"
                  onPress={() => {
                    onSelect(null);
                    setOpen(false);
                  }}
                >
                  <Text>{t('tournaments.noTeam')}</Text>
                </Button>
              ) : null}
              <Button className="w-full" onPress={() => setOpen(false)}>
                <Text>{t('common.cancel')}</Text>
              </Button>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
