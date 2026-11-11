import { expect, test } from 'bun:test';
import { layoutGraph } from '../src/core/layout';
import type { Coords } from '../src/core/types';

const key = (tile: Coords): string => `${tile.x},${tile.y}`;
const ids = (names: string[]): { id: string }[] => names.map((id) => ({ id }));

test('every edge points down the flow: a target sits at a lower y than its source', () => {
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'a', to: 'd' },
    { from: 'd', to: 'c' }
  ];
  const { tiles } = layoutGraph({ nodes: ids(['a', 'b', 'c', 'd']), edges, groups: [] });

  for (const edge of edges) {
    expect(tiles.get(edge.to)!.y).toBeLessThan(tiles.get(edge.from)!.y);
  }
});

test('a cycle still places every node on its own tile', () => {
  const { tiles } = layoutGraph({
    nodes: ids(['a', 'b', 'c']),
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' }
    ],
    groups: []
  });

  expect(new Set([...tiles.values()].map(key)).size).toBe(3);
});

test('regions hold exactly their own group, never overlap, and no two nodes share a tile', () => {
  const nodes = [
    { id: 'u' },
    { id: 'a1', group: 'a' },
    { id: 'a2', group: 'a' },
    { id: 'a3', group: 'a' },
    { id: 'b1', group: 'b' },
    { id: 'b2', group: 'b' },
    { id: 'c1', group: 'c' },
    { id: 'x' }
  ];
  const { tiles, regions } = layoutGraph({
    nodes,
    edges: [
      { from: 'u', to: 'a1' },
      { from: 'a1', to: 'a2' },
      { from: 'a1', to: 'a3' },
      { from: 'a2', to: 'b1' },
      { from: 'a3', to: 'b2' },
      { from: 'b1', to: 'c1' },
      { from: 'a1', to: 'c1' },
      { from: 'x', to: 'b2' }
    ],
    groups: [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  });

  expect(new Set([...tiles.values()].map(key)).size).toBe(nodes.length);
  for (const [group, region] of regions) {
    for (const node of nodes) {
      const tile = tiles.get(node.id)!;
      const inside =
        tile.x >= region.from.x && tile.x <= region.to.x && tile.y >= region.from.y && tile.y <= region.to.y;
      expect({ node: node.id, group, inside }).toEqual({ node: node.id, group, inside: node.group === group });
    }
  }
  const all = [...regions.values()];
  for (const [index, first] of all.entries()) {
    for (const second of all.slice(index + 1)) {
      const apart =
        first.to.x < second.from.x ||
        second.to.x < first.from.x ||
        first.to.y < second.from.y ||
        second.to.y < first.from.y;
      expect(apart).toBe(true);
    }
  }
});

test('a region title sits on its own row inside the region, clear of every item', () => {
  const { tiles, regions } = layoutGraph({
    nodes: [{ id: 'only', group: 'g' }],
    edges: [],
    groups: [{ id: 'g', labelSpan: 9 }]
  });

  const region = regions.get('g')!;
  const title = region.titleTile;
  expect(region.to.x - region.from.x + 1).toBeGreaterThanOrEqual(9);
  expect(title.x).toBeGreaterThanOrEqual(region.from.x);
  expect(title.x).toBeLessThanOrEqual(region.to.x);
  expect(title.y).toBeLessThanOrEqual(region.to.y);
  expect(title.y).toBeGreaterThan(region.from.y);
  const only = tiles.get('only')!;
  expect(title.y).not.toBe(only.y);
});

test('a long region title stays inside its region', () => {
  const { regions } = layoutGraph({
    nodes: [{ id: 'only', group: 'g' }],
    edges: [],
    groups: [{ id: 'g', labelSpan: 14 }]
  });

  const region = regions.get('g')!;
  // The title starts one tile inside the low corner and spans `labelSpan` tiles, so its last
  // column must be at or before the region's far corner.
  const lastTitleTile = region.titleTile.x + 14 - 1;
  expect(lastTitleTile).toBeLessThanOrEqual(region.to.x);
});

test('a group with no nodes gets no region', () => {
  const { regions } = layoutGraph({ nodes: ids(['a']), edges: [], groups: [{ id: 'empty' }] });

  expect(regions.has('empty')).toBe(false);
});
