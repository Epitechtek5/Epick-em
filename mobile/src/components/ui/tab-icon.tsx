import { View } from 'react-native';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react-native';
import { useTheme } from '@react-navigation/native';
import { colors } from '@/theme/colors';

export function TabIcon({
  icon,
  focused,
  size,
  testID,
}: {
  icon: IconSvgElement;
  focused: boolean;
  size: number;
  testID: string;
}) {
  const { dark } = useTheme();
  const palette = dark ? colors.dark : colors.light;
  return (
    <View className={`rounded-md px-2 py-1 ${focused ? 'bg-primary' : ''}`}>
      <HugeiconsIcon
        icon={icon}
        size={Math.min(size, 20)}
        color={
          focused ? palette['primary-foreground'] : palette['muted-foreground']
        }
        accessible={false}
        testID={testID}
      />
    </View>
  );
}
