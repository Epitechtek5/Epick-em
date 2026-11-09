import { useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ArrowDown01Icon from '@hugeicons/core-free-icons/ArrowDown01Icon';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/i18n';

export function StepOptionSelect<T extends string>({
  label,
  value,
  options,
  labelFor,
  description,
  onSelect,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labelFor: (value: T) => string;
  description?: string;
  onSelect: (value: T) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  return (
    <View className="gap-2">
      <Text className="font-medium">{label}</Text>
      <Button
        className="w-full justify-between"
        variant="outline"
        accessibilityLabel={`${label}: ${labelFor(value)}`}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
      >
        <Text className="min-w-0 flex-1 text-left">{labelFor(value)}</Text>
        <Icon icon={ArrowDown01Icon} size={18} />
      </Button>
      {description ? <Text variant="muted">{description}</Text> : null}
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View className="flex-1 justify-end bg-black/50">
          <View
            className="max-h-[85%] gap-2 rounded-t-xl border border-border bg-card px-5 pt-5"
            style={{ paddingBottom: insets.bottom + 20 }}
            accessibilityViewIsModal
          >
            <Text className="mb-2 text-lg font-semibold">{label}</Text>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerClassName="gap-2"
            >
              {options.map((option) => (
                <Button
                  key={option}
                  className="w-full justify-start"
                  variant={option === value ? 'secondary' : 'ghost'}
                  role="radio"
                  accessibilityState={{ checked: option === value }}
                  onPress={() => {
                    onSelect(option);
                    setOpen(false);
                  }}
                >
                  <Text className={option === value ? 'font-semibold' : ''}>
                    {labelFor(option)}
                  </Text>
                </Button>
              ))}
            </ScrollView>
            <Button variant="outline" onPress={() => setOpen(false)}>
              <Text>{t('common.cancel')}</Text>
            </Button>
          </View>
        </View>
      </Modal>
    </View>
  );
}
