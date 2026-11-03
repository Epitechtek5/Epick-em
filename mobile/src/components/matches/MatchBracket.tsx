import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useColorScheme } from 'nativewind';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/i18n';
import { cardWidth, layoutBracket } from '@/features/matches/bracket';
import type { MatchContext } from '@/features/matches/context';
import { MatchCard } from './MatchCard';
import { colors } from '@/theme/colors';
export function MatchBracket({
  context,
  open,
}: {
  context: MatchContext;
  open: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const [heights, setHeights] = useState<Record<string, number>>({});
  const graph = layoutBracket(context.matches, heights);
  return (
    <ScrollView horizontal>
      <View>
        <View className="flex-row">
          {graph.rounds.map((round, i) => (
            <Text
              key={i}
              style={{ width: cardWidth + 64, paddingLeft: 24 }}
              className="font-semibold"
            >
              {round
                ? t('matches.roundNumber', { round })
                : t('matches.unknownRound')}
            </Text>
          ))}
        </View>
        <View style={{ width: graph.width, height: graph.height }}>
          <Svg
            width={graph.width}
            height={graph.height}
            style={{ position: 'absolute' }}
          >
            {graph.edges.map((edge) => (
              <Path
                key={edge.from}
                d={edge.path}
                fill="none"
                stroke={colors[colorScheme ?? 'light'].primary}
                strokeWidth={2}
              />
            ))}
          </Svg>
          {graph.regions.map(({ region, y }) => (
            <Text
              key={region ?? 'none'}
              style={{ position: 'absolute', top: y, left: 24 }}
              className="font-semibold"
            >
              {region ? t('matches.region.' + region) : t('matches.bracket')}
            </Text>
          ))}
          {graph.nodes.map(({ match, x, y }) => (
            <View
              key={match.id}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: cardWidth,
              }}
              onLayout={(event) => {
                const height = event.nativeEvent.layout.height;
                setHeights((prev) =>
                  prev[match.id] === height
                    ? prev
                    : { ...prev, [match.id]: height },
                );
              }}
            >
              <MatchCard
                match={match}
                context={context}
                onPress={() => open(match.id)}
              />
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
