import { brackets, type Bracket, type Match } from './types';

export const bracketCardWidth = 224;
export const bracketCardHeight = 116;

const canvasPadding = 24;
const columnGap = 88;
const nodeGap = 36;
const regionHeaderHeight = 40;
const roundHeaderHeight = 32;
const regionGap = 40;
const outerConnectorGutter = 40;

export type BracketRegion = Bracket | null;

export interface BracketNode {
  match: Match;
  x: number;
  y: number;
  width: number;
  height: number;
  region: BracketRegion;
}

export interface BracketRegionLayout {
  region: BracketRegion;
  x: number;
  y: number;
  width: number;
  height: number;
  rounds: { round: number | null; x: number }[];
}

export function fitBracketScale(
  viewportWidth: number,
  viewportHeight: number,
  contentWidth: number,
  contentHeight: number,
) {
  return Math.min(
    viewportWidth / contentWidth,
    viewportHeight / contentHeight,
    1,
  );
}

function compareRounds(left: number | null, right: number | null) {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function compareMatches(left: Match, right: Match) {
  return left.id.localeCompare(right.id);
}

function regionOrder(matches: Match[]): BracketRegion[] {
  const present = new Set(matches.map((match) => match.bracket));
  return [...brackets, null].filter((region) => present.has(region));
}

export function layoutBracket(matches: Match[]) {
  const nodes: BracketNode[] = [];
  const regions: BracketRegionLayout[] = [];
  const incoming = new Map<string, Match[]>();

  for (const match of matches) {
    if (!match.next_match_id) continue;
    const predecessors = incoming.get(match.next_match_id) ?? [];
    predecessors.push(match);
    incoming.set(match.next_match_id, predecessors);
  }

  let regionTop = canvasPadding;
  let contentWidth = 0;

  for (const region of regionOrder(matches)) {
    const members = matches.filter((match) => match.bracket === region);
    const rounds = [...new Set(members.map((match) => match.round))].sort(
      compareRounds,
    );
    const localNodes = new Map<string, BracketNode>();
    const contentTop = regionTop + regionHeaderHeight + roundHeaderHeight;
    let regionBottom = contentTop;

    rounds.forEach((round, columnIndex) => {
      const x = canvasPadding + columnIndex * (bracketCardWidth + columnGap);
      const column = members
        .filter((match) => match.round === round)
        .sort(compareMatches);
      const desiredCenters = column.map((match, index) => {
        const predecessorNodes = (incoming.get(match.id) ?? [])
          .map((predecessor) => localNodes.get(predecessor.id))
          .filter((node): node is BracketNode => Boolean(node));
        const center = predecessorNodes.length
          ? predecessorNodes.reduce(
              (sum, node) => sum + node.y + node.height / 2,
              0,
            ) / predecessorNodes.length
          : contentTop +
            index * (bracketCardHeight + nodeGap) +
            bracketCardHeight / 2;

        return { match, center };
      });

      desiredCenters.sort(
        (left, right) =>
          left.center - right.center || compareMatches(left.match, right.match),
      );

      let previousBottom = contentTop - nodeGap;
      for (const { match, center } of desiredCenters) {
        const y = Math.max(
          center - bracketCardHeight / 2,
          previousBottom + nodeGap,
        );
        const node: BracketNode = {
          match,
          x,
          y,
          width: bracketCardWidth,
          height: bracketCardHeight,
          region,
        };
        nodes.push(node);
        localNodes.set(match.id, node);
        previousBottom = y + bracketCardHeight;
        regionBottom = Math.max(regionBottom, previousBottom);
      }
    });

    const width =
      canvasPadding * 2 +
      rounds.length * bracketCardWidth +
      Math.max(0, rounds.length - 1) * columnGap;
    const height = regionBottom - regionTop + canvasPadding;
    regions.push({
      region,
      x: 0,
      y: regionTop,
      width,
      height,
      rounds: rounds.map((round, index) => ({
        round,
        x: canvasPadding + index * (bracketCardWidth + columnGap),
      })),
    });
    contentWidth = Math.max(contentWidth, width);
    regionTop += height + regionGap;
  }

  const byId = new Map(nodes.map((node) => [node.match.id, node]));
  const needsOuterConnectorGutter = nodes.some((node) => {
    const successor = node.match.next_match_id
      ? byId.get(node.match.next_match_id)
      : undefined;
    return (
      successor && (successor.region !== node.region || successor.x <= node.x)
    );
  });
  const width = Math.max(
    1,
    contentWidth + (needsOuterConnectorGutter ? outerConnectorGutter : 0),
  );
  const edges = nodes.flatMap((node) => {
    const successor = node.match.next_match_id
      ? byId.get(node.match.next_match_id)
      : undefined;
    if (!successor) return [];

    const startX = node.x + node.width;
    const startY = node.y + node.height / 2;
    const endY = successor.y + successor.height / 2;
    const crossRegion = successor.region !== node.region;
    const routeOutside = crossRegion || successor.x <= node.x;
    const endX = routeOutside ? successor.x + successor.width : successor.x;
    const gutterX = routeOutside
      ? width - outerConnectorGutter / 2
      : (startX + endX) / 2;

    return [
      {
        from: node.match.id,
        to: successor.match.id,
        path: `M ${startX} ${startY} H ${gutterX} V ${endY} H ${endX}`,
      },
    ];
  });

  return {
    rounds: [...new Set(matches.map((match) => match.round))].sort(
      compareRounds,
    ),
    regions,
    nodes,
    edges,
    width,
    height: Math.max(1, regionTop - regionGap + canvasPadding),
  };
}
