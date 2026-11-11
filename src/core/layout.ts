import type { Coords } from './types';

export interface LayoutInput {
  nodes: { id: string; group?: string }[];
  edges: { from: string; to: string }[];
  /** `labelSpan`: tiles the group's title needs along its region's edge. */
  groups: { id: string; labelSpan?: number }[];
}

export interface LayoutResult {
  tiles: Map<string, Coords>;
  /** Region rectangle per group that has at least one node, with the tile its title starts on. */
  regions: Map<string, { from: Coords; to: Coords; titleTile: Coords }>;
}

/** Tile distance between neighbouring items: two empty tiles, enough room for labels. */
const NODE_GAP = 3;
/** Tiles a region extends beyond its items. */
const REGION_PAD = 1;
/** Empty tiles between side-by-side units: both region pads plus one clear tile. */
const CROSS_SPACE = 3;
/** Empty tiles between successive units: both region pads, a clear tile and a title row. */
const FLOW_SPACE = 4;
/** Tiles between a region's title row and its first item row: clear of icon artwork and labels. */
const LABEL_CLEARANCE = 3;

/**
 * Layered ordering of a directed graph: longest-path layers, then barycentre sweeps to reduce
 * crossings. Edges that would close a cycle are ignored for layering.
 */
function layers(ids: string[], edges: { from: string; to: string }[]): string[][] {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const { from, to } of edges) {
    const targets = out.get(from);
    if (!targets || !out.has(to) || from === to || targets.includes(to)) continue;
    targets.push(to);
    indegree.set(to, indegree.get(to)! + 1);
  }

  // Depth-first from the sources. An edge back into the open path closes a cycle and is dropped;
  // every kept edge then points forward in reverse finishing order.
  const open = new Set<string>();
  const done = new Set<string>();
  const kept = new Map<string, string[]>(ids.map((id) => [id, []]));
  const finished: string[] = [];
  const visit = (id: string): void => {
    open.add(id);
    for (const next of out.get(id)!) {
      if (open.has(next)) continue;
      kept.get(id)!.push(next);
      if (!done.has(next)) visit(next);
    }
    open.delete(id);
    done.add(id);
    finished.push(id);
  };
  for (const id of [...ids.filter((candidate) => indegree.get(candidate) === 0), ...ids]) {
    if (!done.has(id)) visit(id);
  }

  const depth = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const id of finished.reverse()) {
    for (const next of kept.get(id)!) {
      depth.set(next, Math.max(depth.get(next)!, depth.get(id)! + 1));
    }
  }
  const rows: string[][] = [];
  for (const id of ids) (rows[depth.get(id)!] ??= []).push(id);

  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [id, targets] of kept) {
    for (const target of targets) {
      neighbours.get(id)!.push(target);
      neighbours.get(target)!.push(id);
    }
  }
  const position = new Map<string, number>();
  for (const row of rows) row.forEach((id, index) => position.set(id, index));
  for (let sweep = 0; sweep < 4; sweep++) {
    const downward = sweep % 2 === 0;
    for (const row of downward ? rows.slice(1) : rows.slice(0, -1).reverse()) {
      const reference = depth.get(row[0])! + (downward ? -1 : 1);
      const weight = new Map<string, number>();
      for (const id of row) {
        const anchors = neighbours
          .get(id)!
          .filter((neighbour) => depth.get(neighbour) === reference)
          .map((neighbour) => position.get(neighbour)!);
        weight.set(
          id,
          anchors.length === 0
            ? position.get(id)!
            : anchors.reduce((sum, value) => sum + value, 0) / anchors.length
        );
      }
      row.sort((a, b) => weight.get(a)! - weight.get(b)! || position.get(a)! - position.get(b)!);
      row.forEach((id, index) => position.set(id, index));
    }
  }
  return rows;
}

/**
 * Place nodes on the tile grid. Each group is laid out as its own block and the blocks (plus
 * ungrouped nodes) are then layered against each other, so regions never overlap. The flow runs
 * along -y, which reads from the upper left to the lower right of the isometric picture; nodes
 * that share a layer spread along +x.
 */
export function layoutGraph(input: LayoutInput): LayoutResult {
  const groupIds = new Set(input.groups.map((group) => group.id));
  const unitOf = new Map<string, string>();
  const members = new Map<string, string[]>();
  for (const node of input.nodes) {
    const unit =
      node.group !== undefined && groupIds.has(node.group) ? `group:${node.group}` : `node:${node.id}`;
    unitOf.set(node.id, unit);
    const list = members.get(unit);
    if (list) list.push(node.id);
    else members.set(unit, [node.id]);
  }
  const edges = input.edges.filter((edge) => unitOf.has(edge.from) && unitOf.has(edge.to));
  const unitEdges = edges.map((edge) => ({ from: unitOf.get(edge.from)!, to: unitOf.get(edge.to)! }));
  const labelSpan = new Map(input.groups.map((group) => [`group:${group.id}`, group.labelSpan ?? 0]));

  const tiles = new Map<string, Coords>();
  const regions = new Map<string, { from: Coords; to: Coords; titleTile: Coords }>();
  let flow = 0;
  for (const row of layers([...members.keys()], unitEdges)) {
    const blocks = row.map((unit) => {
      const inner = edges.filter((edge) => unitOf.get(edge.from) === unit && unitOf.get(edge.to) === unit);
      const rows = layers(members.get(unit)!, inner);
      const natural = (Math.max(...rows.map((ids) => ids.length)) - 1) * NODE_GAP + 1;
      const titled = (labelSpan.get(unit) ?? 0) > 0;
      return {
        unit,
        rows,
        titled,
        // `crossSpan` is the space between the region's padded edges, and the title starts one
        // tile inside the low edge, so the span itself is exactly what the title needs at most.
        // Subtracting the padding here would run the title two tiles past the region's far corner.
        crossSpan: Math.max(natural, labelSpan.get(unit) ?? 0),
        // A titled block keeps a clear row for its title above its items.
        flowSpan: (rows.length - 1) * NODE_GAP + 1 + (titled ? LABEL_CLEARANCE : 0)
      };
    });
    const total =
      blocks.reduce((sum, block) => sum + block.crossSpan, 0) + CROSS_SPACE * (blocks.length - 1);
    // `0 - n` rather than `-n` so an origin coordinate is +0, not -0.
    let cross = 0 - Math.floor(total / 2);
    for (const block of blocks) {
      const top = 0 - flow;
      // Nodes start below the title row, leaving room for the title and the first row's labels.
      const firstRow = top - (block.titled ? LABEL_CLEARANCE : 0);
      const bottom = firstRow - (block.rows.length - 1) * NODE_GAP;
      block.rows.forEach((ids, depth) => {
        const inset = Math.floor((block.crossSpan - ((ids.length - 1) * NODE_GAP + 1)) / 2);
        ids.forEach((id, index) => {
          tiles.set(id, { x: cross + inset + index * NODE_GAP, y: firstRow - depth * NODE_GAP });
        });
      });
      if (block.unit.startsWith('group:')) {
        const lowX = cross - REGION_PAD;
        regions.set(block.unit.slice('group:'.length), {
          from: { x: lowX, y: bottom - REGION_PAD },
          to: { x: cross + block.crossSpan - 1 + REGION_PAD, y: top + REGION_PAD },
          titleTile: { x: lowX + REGION_PAD, y: top }
        });
      }
      cross += block.crossSpan + CROSS_SPACE;
    }
    flow += Math.max(...blocks.map((block) => block.flowSpan)) + FLOW_SPACE;
  }
  return { tiles, regions };
}
