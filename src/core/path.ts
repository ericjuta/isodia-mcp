import PF from 'pathfinding';
import type { Connector, ConnectorAnchor, Coords, View } from './types';

/** Tiles the search area extends beyond the anchors, so a route can step around its ends. */
const SEARCH_OFFSET = 1;

export interface ConnectorPath {
  /** Corner of the search area with the highest x and y; path tiles are counted from here. */
  origin: Coords;
  /** Search area size in tiles. */
  size: { width: number; height: number };
  /** Path tiles relative to `origin`, counted toward lower x and lower y. */
  tiles: Coords[];
}

function anchorTile(anchor: ConnectorAnchor, view: View, visited: Set<string>): Coords {
  if (anchor.ref.item !== undefined) {
    const item = view.items.find((candidate) => candidate.id === anchor.ref.item);
    if (!item) throw new Error(`Anchor "${anchor.id}" references missing item "${anchor.ref.item}".`);
    return item.tile;
  }
  if (anchor.ref.anchor !== undefined) {
    if (visited.has(anchor.id)) throw new Error(`Anchor "${anchor.id}" is part of a reference cycle.`);
    visited.add(anchor.id);
    const target = (view.connectors ?? [])
      .flatMap((connector) => connector.anchors)
      .find((candidate) => candidate.id === anchor.ref.anchor);
    if (!target) throw new Error(`Anchor "${anchor.id}" references missing anchor "${anchor.ref.anchor}".`);
    return anchorTile(target, view, visited);
  }
  if (anchor.ref.tile) return anchor.ref.tile;
  throw new Error(`Anchor "${anchor.id}" has no reference.`);
}

/**
 * The tiles a connector runs through: A* with diagonal moves inside the anchors' bounding box
 * grown by one tile, one segment per consecutive anchor pair. Other tools that read the model
 * format route the same way, so a file looks the same there.
 */
export function connectorPath(connector: Connector, view: View): ConnectorPath {
  if (connector.anchors.length < 2) {
    throw new Error(`Connector "${connector.id}" needs at least two anchors.`);
  }
  const positions = connector.anchors.map((anchor) => anchorTile(anchor, view, new Set()));
  const xs = positions.map((position) => position.x);
  const ys = positions.map((position) => position.y);
  const origin = { x: Math.max(...xs) + SEARCH_OFFSET, y: Math.max(...ys) + SEARCH_OFFSET };
  const size = {
    width: origin.x - (Math.min(...xs) - SEARCH_OFFSET) + 1,
    height: origin.y - (Math.min(...ys) - SEARCH_OFFSET) + 1
  };
  const local = positions.map((position) => ({ x: origin.x - position.x, y: origin.y - position.y }));

  const finder = new PF.AStarFinder({
    heuristic: PF.Heuristic.manhattan,
    diagonalMovement: PF.DiagonalMovement.Always
  });
  const tiles: Coords[] = [];
  for (let index = 1; index < local.length; index++) {
    const from = local[index - 1];
    const to = local[index];
    // The finder marks the grid it searches, so each segment gets a fresh one.
    const segment = finder.findPath(from.x, from.y, to.x, to.y, new PF.Grid(size.width, size.height));
    for (const [x, y] of segment) tiles.push({ x, y });
  }
  return { origin, size, tiles };
}
