import { connectorPath } from './path';
import { textBoxSpan } from './text';
import type { Connector, Coords, Rectangle, TextBox, View } from './types';

/**
 * What stands on a tile. The editor works in tiles, not pixels: a press is resolved to a tile
 * first, and then to whatever occupies it, so tall icons and labels never steal a press meant
 * for the thing behind them.
 */

export type TargetKind = 'item' | 'text' | 'connector' | 'region';

export interface Target {
  kind: TargetKind;
  id: string;
}

const DEFAULT_TEXT_SIZE = 0.6;

/** A region's extent with its corners in order, whichever way it was drawn. */
export function regionBox(region: Rectangle): { lowX: number; highX: number; lowY: number; highY: number } {
  return {
    lowX: Math.min(region.from.x, region.to.x),
    highX: Math.max(region.from.x, region.to.x),
    lowY: Math.min(region.from.y, region.to.y),
    highY: Math.max(region.from.y, region.to.y)
  };
}

/** Tiles a text box lies on: from its tile along +x, or along -y when it runs the other way. */
export function textTiles(text: TextBox): Coords[] {
  const count = Math.max(1, Math.ceil(textBoxSpan(text.content, text.fontSize ?? DEFAULT_TEXT_SIZE) + 1));
  return Array.from({ length: count }, (_, step) =>
    text.orientation === 'Y' ? { x: text.tile.x, y: text.tile.y - step } : { x: text.tile.x + step, y: text.tile.y }
  );
}

/** Tiles a connector runs through, in order; empty when its anchors no longer resolve. */
export function connectorTiles(connector: Connector, view: View): Coords[] {
  try {
    const path = connectorPath(connector, view);
    return path.tiles.map((tile) => ({ x: path.origin.x - tile.x, y: path.origin.y - tile.y }));
  } catch {
    return [];
  }
}

const on = (tiles: Coords[], tile: Coords): boolean => tiles.some((entry) => entry.x === tile.x && entry.y === tile.y);

/**
 * The thing a press on `tile` means. Items win, then text, then connectors, then the smallest
 * region around the tile: the order of how hard each is to hit any other way.
 */
export function whatIsAt(view: View, tile: Coords): Target | null {
  const item = view.items.find((entry) => entry.tile.x === tile.x && entry.tile.y === tile.y);
  if (item) return { kind: 'item', id: item.id };

  const text = (view.textBoxes ?? []).find((entry) => on(textTiles(entry), tile));
  if (text) return { kind: 'text', id: text.id };

  const connector = (view.connectors ?? []).find((entry) => on(connectorTiles(entry, view), tile));
  if (connector) return { kind: 'connector', id: connector.id };

  const around = (view.rectangles ?? [])
    .map((region) => ({ region, box: regionBox(region) }))
    .filter(({ box }) => tile.x >= box.lowX && tile.x <= box.highX && tile.y >= box.lowY && tile.y <= box.highY)
    .sort(
      (a, b) =>
        (a.box.highX - a.box.lowX + 1) * (a.box.highY - a.box.lowY + 1) -
        (b.box.highX - b.box.lowX + 1) * (b.box.highY - b.box.lowY + 1)
    );
  return around.length > 0 ? { kind: 'region', id: around[0].region.id } : null;
}

/** Whether a target still exists in a view; a selection outlives edits only while this holds. */
export function exists(view: View, target: Target): boolean {
  const pool =
    target.kind === 'item'
      ? view.items
      : target.kind === 'text'
        ? (view.textBoxes ?? [])
        : target.kind === 'connector'
          ? (view.connectors ?? [])
          : (view.rectangles ?? []);
  return pool.some((entry) => entry.id === target.id);
}
