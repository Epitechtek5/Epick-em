import { useState, type ComponentProps } from 'react';
import { View } from 'react-native';
import ViewIcon from '@hugeicons/core-free-icons/ViewIcon';
import ViewOffIcon from '@hugeicons/core-free-icons/ViewOffIcon';
import { useTranslation } from '@/i18n';
import { Button } from './button';
import { Icon } from './icon';
import { Input } from './input';

export function PasswordInput(props: ComponentProps<typeof Input>) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <View className="relative justify-center">
      <Input
        {...props}
        className={`pr-14 ${props.className ?? ''}`}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-1 min-h-11 min-w-11"
        disabled={props.editable === false}
        accessibilityLabel={t(
          visible ? 'common.hidePassword' : 'common.showPassword',
          { label: props.accessibilityLabel },
        )}
        onPress={() => setVisible((previous) => !previous)}
      >
        <Icon icon={visible ? ViewOffIcon : ViewIcon} />
      </Button>
    </View>
  );
}
