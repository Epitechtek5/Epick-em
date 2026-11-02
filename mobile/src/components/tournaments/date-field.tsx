import { useState } from 'react';
import { Modal, Platform, View } from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/i18n';
import { formatTournamentDate } from '@/features/tournaments/presentation';

export function TournamentDateField({
  label,
  value,
  onChange,
  optional = false,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  optional?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { colorScheme } = useColorScheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(new Date());
  const selected = value ? new Date(value) : new Date();

  function show() {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: selected,
        mode: 'date',
        onValueChange: (_event, date) => {
          if (!date) return;
          const next = new Date(date);
          next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
          DateTimePickerAndroid.open({
            value: next,
            mode: 'time',
            is24Hour: true,
            onValueChange: (_timeEvent, time) => {
              if (time) onChange(time.toISOString());
            },
          });
        },
      });
    } else {
      setDraft(selected);
      setOpen(true);
    }
  }

  return (
    <View className="gap-2">
      <Text className="font-medium">{label}</Text>
      <Button variant="outline" accessibilityLabel={label} onPress={show}>
        <Text>
          {value
            ? formatTournamentDate(value, i18n.language)
            : t('tournaments.chooseDate')}
        </Text>
      </Button>
      {optional && value ? (
        <Button size="sm" variant="ghost" onPress={() => onChange(null)}>
          <Text>{t('tournaments.clearDate')}</Text>
        </Button>
      ) : null}
      {Platform.OS === 'ios' ? (
        <Modal
          visible={open}
          transparent
          animationType="fade"
          onRequestClose={() => setOpen(false)}
        >
          <View className="flex-1 justify-end bg-black/50">
            <View
              className="gap-3 rounded-t-xl bg-card px-5 pt-5"
              style={{ paddingBottom: insets.bottom + 20 }}
            >
              <Text className="text-lg font-semibold">{label}</Text>
              <DateTimePicker
                value={draft}
                mode="datetime"
                display="spinner"
                themeVariant={colorScheme === 'dark' ? 'dark' : 'light'}
                onValueChange={(_event, date) => {
                  if (date) setDraft(date);
                }}
              />
              <View className="flex-row gap-2">
                <Button
                  className="flex-1"
                  variant="outline"
                  onPress={() => setOpen(false)}
                >
                  <Text>{t('common.cancel')}</Text>
                </Button>
                <Button
                  className="flex-1"
                  onPress={() => {
                    onChange(draft.toISOString());
                    setOpen(false);
                  }}
                >
                  <Text>{t('common.confirm')}</Text>
                </Button>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
