import { expect, test } from 'bun:test';
import { applyOperations, emptyModel } from '../src/core/model';
import { connectorPath } from '../src/core/path';
import { svgToPng } from '../src/core/png';
import { renderViewSvg } from '../src/core/render';
import type { Coords, View } from '../src/core/types';

const row = (via?: Coords[]): View =>
  applyOperations(emptyModel('Row'), undefined, [
    { op: 'add_item', name: 'A', tile: { x: 0, y: 0 } },
    { op: 'add_item', name: 'B', tile: { x: 3, y: 0 } },
    { op: 'connect', from: 'a', to: 'b', via }
  ]).model.views[0];

/** Path tiles in grid coordinates. */
function route(view: View): Coords[] {
  const path = connectorPath(view.connectors![0], view);
  return path.tiles.map((tile) => ({ x: path.origin.x - tile.x, y: path.origin.y - tile.y }));
}

test('a connector between two items in a row runs straight through the tiles between them', () => {
  expect(route(row())).toEqual([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 }
  ]);
});

test('a waypoint pulls the connector through its tile', () => {
  const tiles = route(row([{ x: 1, y: 3 }]));

  expect(tiles[0]).toEqual({ x: 0, y: 0 });
  expect(tiles).toContainEqual({ x: 1, y: 3 });
  expect(tiles.at(-1)).toEqual({ x: 3, y: 0 });
});

test('the rendered picture frames every item', () => {
  // A flat (non-isometric) icon lies on its tile instead of standing on it; it is framed too.
  const flatLogo = { id: 'logo', name: 'Logo', url: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAiIGhlaWdodD0iMTAiLz4=', isIsometric: false };
  const { model } = applyOperations({ ...emptyModel('Spread'), icons: [flatLogo] }, undefined, [
    { op: 'add_item', name: 'North', tile: { x: 12, y: 9 } },
    { op: 'add_item', name: 'South', tile: { x: -7, y: -15 } },
    { op: 'add_item', name: 'Flat', icon: 'logo', tile: { x: 8, y: -11 } }
  ]);
  const view = model.views[0];

  const { svg } = renderViewSvg(model, view);
  const [x, y, width, height] = /viewBox="([^"]+)"/.exec(svg)![1].split(' ').map(Number);

  // The projection: a tile is 141.5 x 81.9 on screen.
  for (const { tile } of view.items) {
    const screenX = 70.75 * (tile.x - tile.y);
    const screenY = -40.95 * (tile.x + tile.y);
    expect(screenX).toBeGreaterThan(x);
    expect(screenX).toBeLessThan(x + width);
    expect(screenY).toBeGreaterThan(y);
    expect(screenY).toBeLessThan(y + height);
  }
});

test('names with markup characters render as text, and the PNG has the requested width', () => {
  const { model } = applyOperations(emptyModel('Escapes'), undefined, [
    { op: 'add_item', name: 'A <b> & "c"', tile: { x: 0, y: 0 } },
    { op: 'add_text', content: '</svg><script>', tile: { x: 0, y: 2 } }
  ]);

  const { svg } = renderViewSvg(model, model.views[0]);
  const png = Buffer.from(svgToPng(svg, 640));

  expect(svg).toContain('A &lt;b&gt; &amp; &quot;c&quot;');
  expect(svg).not.toContain('<script>');
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(640);
});

test('a connector label avoids sitting on an item tile', () => {
  // Items paint after connector labels, so a label on an item's tile disappears behind the icon.
  // A straight vertical run with an item parked on its middle tile is the shape that hit this.
  const { model } = applyOperations(emptyModel('Avoid'), undefined, [
    { op: 'add_item', name: 'A', tile: { x: 0, y: 0 } },
    { op: 'add_item', name: 'Middle', tile: { x: 0, y: 3 } },
    { op: 'add_item', name: 'B', tile: { x: 0, y: 6 } },
    { op: 'connect', from: 'a', to: 'b', label: 'flow' }
  ]);
  const view = model.views[0];

  const { svg } = renderViewSvg(model, view);
  const label = /<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>flow<\/text>/.exec(svg)!;
  const labelAt = { x: Number(label[1]), y: Number(label[2]) };
  const centre = (tile: Coords): Coords => ({ x: 70.75 * (tile.x - tile.y), y: -40.95 * (tile.x + tile.y) });

  for (const { tile } of view.items) {
    const item = centre(tile);
    const onItem = Math.abs(item.x - labelAt.x) <= 1 && Math.abs(item.y - labelAt.y) <= 40;
    expect(onItem).toBe(false);
  }
});

test('two connector labels never share a tile', () => {
  // Stacked labels: two connectors with the same route pick the same middle tile, and the later
  // box hides the earlier one. Each label must land on its own tile.
  const { model } = applyOperations(emptyModel('Stacked'), undefined, [
    { op: 'add_item', name: 'A', tile: { x: 0, y: 0 } },
    { op: 'add_item', name: 'B', tile: { x: 0, y: 8 } },
    { op: 'connect', from: 'a', to: 'b', label: 'first' },
    { op: 'connect', from: 'a', to: 'b', label: 'second' }
  ]);

  const { svg } = renderViewSvg(model, model.views[0]);
  const positions = [...svg.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>(first|second)<\/text>/g)].map(
    (match) => `${match[1]},${match[2]}`
  );

  expect(positions).toHaveLength(2);
  expect(new Set(positions).size).toBe(2);
});

test('an empty or whitespace-only label leaves the picture intact', () => {
  // A label wrapping to no lines once produced rect x="Infinity" width="-Infinity", which made the
  // whole viewBox NaN: every item disappeared, not just the label.
  const { model } = applyOperations(emptyModel('Blank labels'), undefined, [
    { op: 'add_item', name: 'A', tile: { x: 0, y: 0 } },
    { op: 'add_item', name: 'B', tile: { x: 3, y: 0 } },
    { op: 'connect', from: 'a', to: 'b', label: '   ' },
    { op: 'add_text', content: '  ', tile: { x: 0, y: 3 } }
  ]);

  const { svg } = renderViewSvg(model, model.views[0]);

  expect(svg).not.toMatch(/NaN|Infinity/);
  expect(svg).toMatch(/viewBox="-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+"/);
  // The items themselves still render.
  expect(svg).toContain('>A</text>');
  expect(svg).toContain('>B</text>');
  expect(Buffer.from(svgToPng(svg, 640)).subarray(1, 4).toString('latin1')).toBe('PNG');
});
