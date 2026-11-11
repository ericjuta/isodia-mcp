import PF from 'pathfinding';
import { textBoxSpan } from './text';
import type { Connector, ConnectorAnchor, Coords, TextBox, View } from './types';

const DEFAULT_TEXT_SIZE = 0.6;

/** Tiles a text box lies on: from its tile along +x, or along -y when it runs the other way. */
export function textTiles(text: TextBox): Coords[] {
  const count = Math.max(1, Math.ceil(textBoxSpan(text.content, text.fontSize ?? DEFAULT_TEXT_SIZE) + 1));
  return Array.from({ length: count }, (_, step) =>
    text.orientation === 'Y' ? { x: text.tile.x, y: text.tile.y - step } : { x: text.tile.x + step, y: text.tile.y }
  );
}

/** Tiles the search area extends beyond the anchors, so a route can step around its ends. */
const SEARCH_OFFSET = 1;

/** Wider boxes tried in turn when obstacles wall a route off, before it crosses them. */
const DETOUR_OFFSETS = [SEARCH_OFFSET, 3, 6];

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
 * grown by one tile, one segment per consecutive anchor pair. A route steps around text and
 * items other than its own ends, widening the box when it must; only a connector that cannot
 * get around them at all crosses them on the open grid.
 */
export function connectorPath(connector: Connector, view: View): ConnectorPath {
  if (connector.anchors.length < 2) {
    throw new Error(`Connector "${connector.id}" needs at least two anchors.`);
  }
  const positions = connector.anchors.map((anchor) => anchorTile(anchor, view, new Set()));
  const obstacles = [...view.items.map((item) => item.tile), ...(view.textBoxes ?? []).flatMap(textTiles)];
  for (const offset of DETOUR_OFFSETS) {
    const path = route(positions, obstacles, offset);
    if (path) return path;
  }
  return route(positions, [], SEARCH_OFFSET)!;
}

/** One route within the anchors' box grown by `offset`, or null when obstacles wall a segment off. */
function route(positions: Coords[], obstacles: Coords[], offset: number): ConnectorPath | null {
  const xs = positions.map((position) => position.x);
  const ys = positions.map((position) => position.y);
  const origin = { x: Math.max(...xs) + offset, y: Math.max(...ys) + offset };
  const size = {
    width: origin.x - (Math.min(...xs) - offset) + 1,
    height: origin.y - (Math.min(...ys) - offset) + 1
  };
  const local = positions.map((position) => ({ x: origin.x - position.x, y: origin.y - position.y }));
  const ends = new Set(local.map((tile) => `${tile.x},${tile.y}`));
  const blocked = obstacles
    .map((tile) => ({ x: origin.x - tile.x, y: origin.y - tile.y }))
    .filter((tile) => tile.x >= 0 && tile.y >= 0 && tile.x < size.width && tile.y < size.height)
    .filter((tile) => !ends.has(`${tile.x},${tile.y}`));
  const finder = new PF.AStarFinder({
    heuristic: PF.Heuristic.manhattan,
    diagonalMovement: PF.DiagonalMovement.Always
  });
  const tiles: Coords[] = [];
  for (let index = 1; index < local.length; index++) {
    const from = local[index - 1];
    const to = local[index];
    // The finder marks the grid it searches, so each search gets a fresh one.
    const grid = new PF.Grid(size.width, size.height);
    for (const tile of blocked) grid.setWalkableAt(tile.x, tile.y, false);
    const segment = finder.findPath(from.x, from.y, to.x, to.y, grid);
    if (segment.length === 0) return null;
    for (const [x, y] of segment) tiles.push({ x, y });
  }
  return { origin, size, tiles };
}
