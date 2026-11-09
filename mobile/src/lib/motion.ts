import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import {
  Easing,
  FadeIn,
  LinearTransition,
  ReduceMotion,
  useReducedMotion,
} from 'react-native-reanimated';

export const interactionTiming = {
  duration: 180,
  easing: Easing.out(Easing.quad),
  reduceMotion: ReduceMotion.System,
};
export const contentEntrance = FadeIn.duration(180).reduceMotion(
  ReduceMotion.System,
);
export const contentLayout = LinearTransition.duration(200).reduceMotion(
  ReduceMotion.System,
);

export function pressScale(pressed: boolean, reducedMotion: boolean): number {
  return pressed && !reducedMotion ? 0.98 : 1;
}

export function useReducedMotionPreference(): boolean {
  const initialPreference = useReducedMotion();
  const [reducedMotion, setReducedMotion] = useState(initialPreference);
  useEffect(() => {
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );
    return () => subscription.remove();
  }, []);
  return reducedMotion;
}
