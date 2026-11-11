import { expect, test } from 'bun:test';
import { connectorTiles, whatIsAt } from '../src/core/hit';
import { applyOperations, emptyModel } from '../src/core/model';
import { tileAt, tileCenter } from '../src/core/render';

const view = applyOperations(emptyModel('Hit'), undefined, [
  { op: 'add_item', name: 'A', tile: { x: 0, y: 0 } },
  { op: 'add_item', name: 'B', tile: { x: 4, y: 0 } },
  { op: 'connect', from: 'a', to: 'b' },
  { op: 'add_region', from: { x: -1, y: -2 }, to: { x: 5, y: 2 }, label: 'Outer' },
  { op: 'add_region', from: { x: -1, y: -1 }, to: { x: 1, y: 1 } },
  { op: 'add_text', content: 'Down', tile: { x: 3, y: -1 }, orientation: 'Y' }
]).model.views[0];

test('a press resolves to the hardest thing to hit on that tile', () => {
  // An item wins over the connector that ends on it and the regions around it.
  expect(whatIsAt(view, { x: 0, y: 0 })).toEqual({ kind: 'item', id: 'a' });
  // Mid-route there is only the line, over the outer region.
  expect(whatIsAt(view, { x: 2, y: 0 })).toEqual({ kind: 'connector', id: 'a-to-b' });
  // Of two nested regions, the smaller one.
  expect(whatIsAt(view, { x: 1, y: -1 })).toEqual({ kind: 'region', id: 'region-2' });
  expect(whatIsAt(view, { x: 5, y: -2 })).toEqual({ kind: 'region', id: 'region' });
  expect(whatIsAt(view, { x: 9, y: 9 })).toBeNull();
});

test('text is hit along the tiles it runs over, in the direction it runs', () => {
  // The outer region's title starts at (0, 1) and runs toward +x, across the inner region.
  expect(whatIsAt(view, { x: 2, y: 1 })).toEqual({ kind: 'text', id: 'region-label' });
  expect(whatIsAt(view, { x: 0, y: 2 })).toEqual({ kind: 'region', id: 'region' });
  // "Down" starts at (3, -1) and runs toward -y, not +x.
  expect(whatIsAt(view, { x: 3, y: -2 })).toEqual({ kind: 'text', id: 'text' });
  expect(whatIsAt(view, { x: 4, y: -1 })).toEqual({ kind: 'region', id: 'region' });
});

test('a screen position maps back to the tile it was drawn from, anywhere inside the diamond', () => {
  for (const tile of [
    { x: 0, y: 0 },
    { x: 7, y: -3 },
    { x: -4, y: 9 }
  ]) {
    const at = tileCenter(tile);
    expect(tileAt(at)).toEqual(tile);
    // Near each of the four vertices, still inside.
    expect(tileAt({ x: at.x + 60, y: at.y })).toEqual(tile);
    expect(tileAt({ x: at.x - 60, y: at.y })).toEqual(tile);
    expect(tileAt({ x: at.x, y: at.y + 35 })).toEqual(tile);
    expect(tileAt({ x: at.x, y: at.y - 35 })).toEqual(tile);
  }
  // Just past the right-hand vertex is the neighbour.
  expect(tileAt({ x: 80, y: 0 })).not.toEqual({ x: 0, y: 0 });
});

test('a connector steps around text and other items, and crosses them only when it must', () => {
  const route = (walls: boolean) => {
    const view = applyOperations(emptyModel('Route'), undefined, [
      { op: 'add_item', name: 'A', tile: { x: 0, y: 0 } },
      { op: 'add_item', name: 'B', tile: { x: 4, y: 0 } },
      { op: 'add_item', name: 'Middle', tile: { x: 2, y: 0 } },
      ...(walls
        ? ([
            { op: 'add_text', content: 'An exceedingly long wall of text that runs far past both ends of the line', tile: { x: -8, y: 1 } },
            { op: 'add_text', content: 'An exceedingly long wall of text that runs far past both ends of the line', tile: { x: -8, y: -1 } }
          ] as const)
        : []),
      { op: 'connect', from: 'A', to: 'B' }
    ]).model.views[0];
    return connectorTiles(view.connectors![0], view).map((tile) => `${tile.x},${tile.y}`);
  };
  expect(route(false)).not.toContain('2,0');
  // Walled in past every widened search box, the line goes through rather than vanishing.
  expect(route(true)).toContain('2,0');
  expect(route(true).at(-1)).toBe('4,0');
});
