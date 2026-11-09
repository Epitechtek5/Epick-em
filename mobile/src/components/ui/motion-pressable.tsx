import type { ComponentProps } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  interactionTiming,
  pressScale,
  useReducedMotionPreference,
} from '@/lib/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function MotionPressable({
  style,
  onPressIn,
  onPressOut,
  ...props
}: ComponentProps<typeof Pressable>) {
  const reducedMotion = useReducedMotionPreference();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reducedMotion ? 1 : scale.get() }],
  }));

  return (
    <AnimatedPressable
      {...props}
      // Callback styles retain their native resolution and caller-owned feedback.
      style={typeof style === 'function' ? style : [style, animatedStyle]}
      onPressIn={(event) => {
        scale.set(
          withTiming(pressScale(true, reducedMotion), interactionTiming),
        );
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.set(withTiming(1, interactionTiming));
        onPressOut?.(event);
      }}
    />
  );
}
