import { brackets, type Match } from './types';
export const cardWidth = 216;
const stride = cardWidth + 64;
export function layoutBracket(
  matches: Match[],
  heights: Record<string, number>,
) {
  const rounds = [...new Set(matches.map((m) => m.round))].sort(
    (a, b) => (a ?? Infinity) - (b ?? Infinity),
  );
  let y = 0;
  const regions = [];
  const nodes: { match: Match; x: number; y: number; height: number }[] = [];
  for (const region of [...brackets, null]) {
    const members = matches.filter((m) => m.bracket === region);
    if (!members.length) continue;
    regions.push({ region, y });
    y += 56;
    const columns = rounds.map((round) =>
      members.filter((m) => m.round === round),
    );
    const rows = Math.max(...columns.map((column) => column.length));
    for (let row = 0; row < rows; row++) {
      let rowHeight = 0;
      columns.forEach((column, index) => {
        const match = column[row];
        if (!match) return;
        const height = heights[match.id] ?? 160;
        nodes.push({ match, x: index * stride + 24, y, height });
        rowHeight = Math.max(rowHeight, height);
      });
      y += rowHeight + 36;
    }
    y += 28;
  }
  const byId = new Map(nodes.map((n) => [n.match.id, n]));
  const edges = nodes.flatMap((n) => {
    const to = n.match.next_match_id && byId.get(n.match.next_match_id);
    if (!to) return [];
    const x = n.x + cardWidth;
    const start = n.y + n.height / 2;
    const end = to.y + to.height / 2;
    // Route through the gutters beside the cards and immediately above the destination.
    const path = `M ${x} ${start} H ${x + 16} V ${to.y - 12} H ${to.x - 12} V ${end} H ${to.x}`;
    return [{ from: n.match.id, to: to.match.id, path }];
  });
  return {
    rounds,
    regions,
    nodes,
    edges,
    width: Math.max(1, rounds.length) * stride,
    height: y,
  };
}
