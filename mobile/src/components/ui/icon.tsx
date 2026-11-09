import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react-native';
import { useColorScheme } from 'nativewind';
import { colors } from '@/theme/colors';

type IconTone =
  | 'foreground'
  | 'muted-foreground'
  | 'primary'
  | 'primary-foreground'
  | 'destructive';

export function Icon({
  icon,
  tone = 'muted-foreground',
  size = 20,
}: {
  icon: IconSvgElement;
  tone?: IconTone;
  size?: number;
}) {
  const { colorScheme } = useColorScheme();
  const palette = colorScheme === 'dark' ? colors.dark : colors.light;
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      color={palette[tone]}
      accessible={false}
    />
  );
}
