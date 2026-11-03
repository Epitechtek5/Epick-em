import { useMemo, useRef, useState } from 'react';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { useColorScheme } from 'nativewind';
import FitToScreenIcon from '@hugeicons/core-free-icons/FitToScreenIcon';
import ZoomInIcon from '@hugeicons/core-free-icons/ZoomInIcon';
import ZoomOutIcon from '@hugeicons/core-free-icons/ZoomOutIcon';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/i18n';
import {
  fitBracketScale,
  layoutBracket,
  type BracketRegionLayout,
} from '@/features/matches/bracket';
import type { MatchContext } from '@/features/matches/context';
import { colors } from '@/theme/colors';
import { BracketMatchCard } from './BracketMatchCard';

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
const PAN_MARGIN = 32;

interface ViewportSize {
  width: number;
  height: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  'worklet';
  return Math.min(Math.max(value, minimum), maximum);
}

function boundedTranslation(
  value: number,
  contentSize: number,
  viewportSize: number,
) {
  'worklet';
  if (contentSize <= viewportSize) return (viewportSize - contentSize) / 2;
  return clamp(value, viewportSize - contentSize - PAN_MARGIN, PAN_MARGIN);
}

export function MatchBracket({
  context,
  open,
}: {
  context: MatchContext;
  open: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const graph = useMemo(
    () => layoutBracket(context.matches),
    [context.matches],
  );
  const [viewport, setViewport] = useState<ViewportSize>({
    width: 0,
    height: 0,
  });
  const [zoomPercent, setZoomPercent] = useState(100);
  const initialFitApplied = useRef(false);
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const minimumScale = useSharedValue(MIN_ZOOM);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);
  const pinchContentX = useSharedValue(0);
  const pinchContentY = useSharedValue(0);
  const viewportWidth = useSharedValue(0);
  const viewportHeight = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.get() },
      { translateY: translateY.get() },
      { scale: scale.get() },
    ],
  }));

  useAnimatedReaction(
    () => Math.round(scale.get() * 100),
    (next, previous) => {
      if (next !== previous) runOnJS(setZoomPercent)(next);
    },
  );

  function setTransform(
    nextScale: number,
    nextX: number,
    nextY: number,
    animated = true,
  ) {
    scale.set(animated ? withTiming(nextScale) : nextScale);
    translateX.set(animated ? withTiming(nextX) : nextX);
    translateY.set(animated ? withTiming(nextY) : nextY);
  }

  function fitBounds(
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    },
    animated = true,
  ) {
    if (!viewport.width || !viewport.height) return;
    const nextScale = fitBracketScale(
      viewport.width,
      viewport.height,
      bounds.width,
      bounds.height,
    );
    minimumScale.set(Math.min(MIN_ZOOM, nextScale));
    setTransform(
      nextScale,
      (viewport.width - bounds.width * nextScale) / 2 - bounds.x * nextScale,
      (viewport.height - bounds.height * nextScale) / 2 - bounds.y * nextScale,
      animated,
    );
  }

  function fitGraph(animated = true) {
    fitBounds(
      { x: 0, y: 0, width: graph.width, height: graph.height },
      animated,
    );
  }

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    if (!width || !height) return;
    setViewport({ width, height });
    viewportWidth.set(width);
    viewportHeight.set(height);
    if (!initialFitApplied.current) {
      initialFitApplied.current = true;
      const initialScale = fitBracketScale(
        width,
        height,
        graph.width,
        graph.height,
      );
      minimumScale.set(Math.min(MIN_ZOOM, initialScale));
      setTransform(
        initialScale,
        (width - graph.width * initialScale) / 2,
        (height - graph.height * initialScale) / 2,
        false,
      );
    }
  }

  function changeZoom(delta: number) {
    if (!viewport.width || !viewport.height) return;
    const currentScale = scale.get();
    const nextScale = clamp(
      Math.round((currentScale + delta) * 10) / 10,
      minimumScale.get(),
      MAX_ZOOM,
    );
    const centerX = viewport.width / 2;
    const centerY = viewport.height / 2;
    const contentX = (centerX - translateX.get()) / currentScale;
    const contentY = (centerY - translateY.get()) / currentScale;
    const nextX = boundedTranslation(
      centerX - contentX * nextScale,
      graph.width * nextScale,
      viewport.width,
    );
    const nextY = boundedTranslation(
      centerY - contentY * nextScale,
      graph.height * nextScale,
      viewport.height,
    );
    setTransform(nextScale, nextX, nextY);
  }

  function resetZoom() {
    if (!viewport.width || !viewport.height) return;
    setTransform(
      1,
      boundedTranslation(PAN_MARGIN, graph.width, viewport.width),
      boundedTranslation(PAN_MARGIN, graph.height, viewport.height),
    );
  }

  const pan = Gesture.Pan()
    .minDistance(6)
    .onStart(() => {
      panStartX.set(translateX.get());
      panStartY.set(translateY.get());
    })
    .onUpdate((event) => {
      const currentScale = scale.get();
      translateX.set(
        boundedTranslation(
          panStartX.get() + event.translationX,
          graph.width * currentScale,
          viewportWidth.get(),
        ),
      );
      translateY.set(
        boundedTranslation(
          panStartY.get() + event.translationY,
          graph.height * currentScale,
          viewportHeight.get(),
        ),
      );
    });

  const pinch = Gesture.Pinch()
    .onStart((event) => {
      const currentScale = scale.get();
      pinchStartScale.set(currentScale);
      pinchContentX.set((event.focalX - translateX.get()) / currentScale);
      pinchContentY.set((event.focalY - translateY.get()) / currentScale);
    })
    .onUpdate((event) => {
      const nextScale = clamp(
        pinchStartScale.get() * event.scale,
        minimumScale.get(),
        MAX_ZOOM,
      );
      const nextX = event.focalX - pinchContentX.get() * nextScale;
      const nextY = event.focalY - pinchContentY.get() * nextScale;
      translateX.set(
        boundedTranslation(nextX, graph.width * nextScale, viewportWidth.get()),
      );
      translateY.set(
        boundedTranslation(
          nextY,
          graph.height * nextScale,
          viewportHeight.get(),
        ),
      );
      scale.set(nextScale);
    });

  const gesture = Gesture.Simultaneous(pan, pinch);
  const palette = colorScheme === 'dark' ? colors.dark : colors.light;
  const showRegionNavigation = graph.regions.length > 1;

  function regionLabel(region: BracketRegionLayout['region']) {
    return region ? t(`matches.region.${region}`) : t('matches.bracket');
  }

  return (
    <View className="min-h-0 flex-1 gap-2">
      <View className="flex-row items-center justify-end gap-1">
        <Button
          variant="outline"
          size="icon"
          accessibilityLabel={t('matches.zoomOut')}
          testID="bracket-zoom-out"
          onPress={() => changeZoom(-0.2)}
        >
          <Icon icon={ZoomOutIcon} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-w-16 px-2"
          accessibilityLabel={t('matches.resetZoom')}
          testID="bracket-reset-zoom"
          onPress={resetZoom}
        >
          <Text>{zoomPercent}%</Text>
        </Button>
        <Button
          variant="outline"
          size="icon"
          accessibilityLabel={t('matches.zoomIn')}
          disabled={zoomPercent >= MAX_ZOOM * 100}
          testID="bracket-zoom-in"
          onPress={() => changeZoom(0.2)}
        >
          <Icon icon={ZoomInIcon} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="px-2"
          accessibilityLabel={t('matches.fitToScreen')}
          testID="bracket-fit"
          onPress={() => fitGraph()}
        >
          <Icon icon={FitToScreenIcon} />
          <Text>{t('matches.fit')}</Text>
        </Button>
      </View>

      {showRegionNavigation ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2"
          accessibilityRole="tablist"
        >
          {graph.regions.map((region) => (
            <Button
              key={region.region ?? 'none'}
              variant="secondary"
              size="sm"
              accessibilityRole="tab"
              accessibilityLabel={t('matches.focusRegion', {
                region: regionLabel(region.region),
              })}
              onPress={() => fitBounds(region)}
            >
              <Text>{regionLabel(region.region)}</Text>
            </Button>
          ))}
        </ScrollView>
      ) : null}

      <GestureDetector gesture={gesture}>
        <View
          className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-muted"
          accessibilityLabel={t('matches.bracketCanvas')}
          onLayout={handleLayout}
        >
          <Animated.View
            collapsable={false}
            style={[
              {
                position: 'absolute',
                left: 0,
                top: 0,
                width: graph.width,
                height: graph.height,
                transformOrigin: [0, 0, 0],
              },
              animatedStyle,
            ]}
          >
            <Svg
              width={graph.width}
              height={graph.height}
              style={{ position: 'absolute' }}
              pointerEvents="none"
            >
              {graph.edges.map((edge) => (
                <Path
                  key={`${edge.from}-${edge.to}`}
                  d={edge.path}
                  fill="none"
                  stroke={palette['chart-2']}
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
              ))}
            </Svg>

            {graph.regions.map((region) => (
              <View key={region.region ?? 'none'}>
                <Text
                  className="font-semibold"
                  style={{ position: 'absolute', top: region.y, left: 24 }}
                >
                  {regionLabel(region.region)}
                </Text>
                {region.rounds.map(({ round, x }) => (
                  <Text
                    key={round ?? 'none'}
                    variant="muted"
                    className="font-medium"
                    style={{
                      position: 'absolute',
                      top: region.y + 40,
                      left: x,
                    }}
                  >
                    {round
                      ? t('matches.roundNumber', { round })
                      : t('matches.unknownRound')}
                  </Text>
                ))}
              </View>
            ))}

            {graph.nodes.map(({ match, x, y }) => (
              <View
                key={match.id}
                style={{ position: 'absolute', left: x, top: y }}
              >
                <BracketMatchCard
                  match={match}
                  context={context}
                  onPress={() => open(match.id)}
                />
              </View>
            ))}
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}
