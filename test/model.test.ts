import { expect, test } from 'bun:test';
import { describeView } from '../src/core/describe';
import { withReferencedIcons } from '../src/core/icons';
import { applyOperations, buildDiagram, createView, deleteView, emptyModel } from '../src/core/model';
import { diagramSpecSchema, type Operation } from '../src/core/operations';
import { parseModel } from '../src/core/schema';
import type { Coords, Model } from '../src/core/types';

/** The model as it would be stored and exported; throws when the schema refuses it. */
const accepted = (model: Model): Model => parseModel(withReferencedIcons(model));

const shop = (): Model =>
  buildDiagram(
    emptyModel('Shop'),
    undefined,
    diagramSpecSchema.parse({
      groups: [{ id: 'core', name: 'Core' }],
      nodes: [
        { id: 'web', name: 'Web', icon: 'desktop' },
        { id: 'api', name: 'API', icon: 'server', group: 'core' },
        { id: 'db', name: 'Database', icon: 'storage', group: 'core' }
      ],
      edges: [
        { from: 'web', to: 'api', label: 'HTTPS' },
        { from: 'api', to: 'db' }
      ]
    })
  ).model;

const edit = (model: Model, operations: Operation[], view?: string): Model =>
  applyOperations(model, view, operations).model;

const tileKeys = (model: Model): string[] => model.views[0].items.map(({ tile }) => `${tile.x},${tile.y}`);

test('a built diagram is a valid model, with a region around its group', () => {
  const model = accepted(shop());
  const view = describeView(model, model.views[0]);

  expect(view.items.map((item) => item.id)).toEqual(['web', 'api', 'db']);
  expect(view.connectors.map(({ from, to, label }) => ({ from, to, label }))).toEqual([
    { from: 'web', to: 'api', label: 'HTTPS' },
    { from: 'api', to: 'db', label: undefined }
  ]);
  expect(view.regions.map(({ id, contains }) => ({ id, contains }))).toEqual([{ id: 'core', contains: ['api', 'db'] }]);
  expect(view.texts.map((text) => text.content)).toEqual(['Core']);
});

test('rebuilding with an edited spec updates items in place and drops the ones left out', () => {
  const rebuilt = buildDiagram(
    shop(),
    undefined,
    diagramSpecSchema.parse({
      nodes: [
        { id: 'web', name: 'Storefront', icon: 'laptop' },
        { id: 'api', name: 'API' }
      ],
      edges: [{ from: 'web', to: 'api' }]
    })
  ).model;

  expect(accepted(rebuilt).items.map(({ id, name, icon }) => ({ id, name, icon }))).toEqual([
    { id: 'web', name: 'Storefront', icon: 'laptop' },
    { id: 'api', name: 'API', icon: 'block' }
  ]);
  expect(rebuilt.views[0].rectangles).toEqual([]);
});

test('an item also shown in another view outlives a rebuild that omits it, until that view goes too', () => {
  const twoViews = createView(shop(), { name: 'Audit', copyFrom: 'overview' }).model;
  const rebuilt = buildDiagram(
    twoViews,
    'overview',
    diagramSpecSchema.parse({ nodes: [{ id: 'web', name: 'Web' }] })
  ).model;

  expect(rebuilt.items.map((item) => item.id).sort()).toEqual(['api', 'db', 'web']);
  expect(deleteView(rebuilt, 'Audit').items.map((item) => item.id)).toEqual(['web']);
});

test('an item can be placed into a second view, sharing one model item', () => {
  const twoViews = createView(shop(), { name: 'Audit' }).model;
  const placed = edit(twoViews, [{ op: 'place_item', item: 'db' }, { op: 'update_item', item: 'db', name: 'Ledger' }], 'audit');

  expect(accepted(placed).views.map((view) => view.items.map((item) => item.id))).toEqual([['web', 'api', 'db'], ['db']]);
  expect(placed.items.filter((item) => item.id === 'db').map((item) => item.name)).toEqual(['Ledger']);
});

test('a failed batch changes nothing and names the failing operation', () => {
  const before = shop();
  const snapshot = structuredClone(before);

  expect(() =>
    applyOperations(before, undefined, [
      { op: 'add_item', name: 'Cache' },
      { op: 'connect', from: 'cache', to: 'nope' }
    ])
  ).toThrow(/Operation 2 \(connect\): No item "nope"/);
  expect(before).toEqual(snapshot);
});

test('removing an item removes its connectors and any connector hanging off those', () => {
  const model = shop();
  model.views[0].connectors!.push({
    id: 'tap',
    anchors: [
      { id: 'tap:0', ref: { anchor: 'web-to-api:1' } },
      { id: 'tap:1', ref: { item: 'db' } }
    ]
  });

  const removed = edit(accepted(model), [{ op: 'remove_item', item: 'web' }]);

  expect(accepted(removed).views[0].connectors!.map((connector) => connector.id)).toEqual(['api-to-db']);
  expect(removed.items.map((item) => item.id)).toEqual(['api', 'db']);
});

test('items added without a tile each land on a free tile', () => {
  const names = Array.from({ length: 12 }, (_, index) => `Node ${index}`);
  const model = edit(
    shop(),
    names.map((name) => ({ op: 'add_item', name }))
  );

  expect(new Set(tileKeys(model)).size).toBe(15);
});

test('an occupied tile is refused, for adding and for moving', () => {
  const model = shop();
  const taken: Coords = model.views[0].items.find((item) => item.id === 'web')!.tile;

  expect(() => edit(model, [{ op: 'add_item', name: 'Twin', tile: taken }])).toThrow(/taken by "web"/);
  expect(() => edit(model, [{ op: 'move_item', item: 'api', tile: taken }])).toThrow(/taken by "web"/);
});

test('colours: a hex value joins the palette once, and an unknown name is refused', () => {
  const model = edit(shop(), [
    { op: 'connect', from: 'web', to: 'db', color: '#FF8800' },
    { op: 'add_region', items: ['web'], color: '#ff8800' }
  ]);
  const view = accepted(model).views[0];

  expect(model.colors.filter((color) => color.value === '#ff8800')).toHaveLength(1);
  expect(view.connectors!.at(-1)!.color).toBe(view.rectangles!.at(-1)!.color!);
  expect(() => edit(shop(), [{ op: 'add_region', items: ['web'], color: 'mauve' }])).toThrow(/Unknown colour "mauve"/);
});

test("a region reads back by colour name under this palette or the original Isoflow one, and by value once repainted", () => {
  const model = shop();
  const regionColor = (): string | undefined => describeView(model, model.views[0]).regions[0].color;
  const blue = model.colors.find((color) => color.id === model.views[0].rectangles![0].color)!;

  expect(regionColor()).toBe('blue');
  blue.value = '#a5b8f3';
  expect(regionColor()).toBe('blue');
  blue.value = '#123456';
  expect(regionColor()).toBe('#123456');
});

test('a name shared by two items is refused in favour of their ids', () => {
  const model = edit(shop(), [
    { op: 'add_item', name: 'Replica' },
    { op: 'add_item', name: 'Replica' }
  ]);

  expect(() => edit(model, [{ op: 'connect', from: 'Replica', to: 'db' }])).toThrow(
    /"Replica" names 2 items.*replica, replica-2/
  );
});

test('auto_layout keeps region membership, moves each title with its region, and drops waypoints', () => {
  const crowded = edit(shop(), [
    { op: 'add_item', name: 'Cache', tile: { x: 9, y: 9 } },
    { op: 'add_region', items: ['cache'], label: 'Clients', color: 'green' },
    { op: 'connect', from: 'api', to: 'cache', via: [{ x: 7, y: 7 }] }
  ]);
  const before = describeView(crowded, crowded.views[0]);

  const tidy = accepted(edit(crowded, [{ op: 'auto_layout' }]));
  const view = tidy.views[0];
  const after = describeView(tidy, view);

  expect(after.regions.map(({ id, contains }) => ({ id, contains: [...contains].sort() }))).toEqual(
    before.regions.map(({ id, contains }) => ({ id, contains: [...contains].sort() }))
  );
  expect(new Set(tileKeys(tidy)).size).toBe(4);
  for (const region of view.rectangles!) {
    const title = view.textBoxes!.find((text) => text.id === `${region.id}-label`)!;
    const lowX = Math.min(region.from.x, region.to.x);
    const lowY = Math.min(region.from.y, region.to.y);
    const highX = Math.max(region.from.x, region.to.x);
    const highY = Math.max(region.from.y, region.to.y);
    // Inside the region and on the row just below its top edge.
    expect(title.tile.y).toBe(highY - 1);
    expect(title.tile.x).toBeGreaterThanOrEqual(lowX);
    expect(title.tile.x).toBeLessThanOrEqual(highX);
    expect(lowY).toBeLessThan(title.tile.y);
  }
  expect(view.connectors!.find((connector) => connector.id === 'api-to-cache')!.anchors).toHaveLength(2);
});

test('the last view cannot be deleted', () => {
  expect(() => deleteView(shop(), 'overview')).toThrow(/only view/);
});

test('each kind of edit produces the described diagram, and the result is a valid model', () => {
  const built = edit(emptyModel('Ops'), [
    { op: 'add_item', name: 'Gateway', icon: 'router', tile: { x: 0, y: 0 } },
    { op: 'add_item', name: 'Service', tile: { x: 3, y: 0 }, description: 'Does work' },
    { op: 'connect', from: 'gateway', to: 'service', label: 'gRPC', style: 'DASHED', width: 14, via: [{ x: 1, y: 2 }] },
    { op: 'add_region', from: { x: 4, y: 1 }, to: { x: -1, y: -1 }, label: 'Cluster', color: 'green' },
    { op: 'add_text', content: 'Draft', tile: { x: 0, y: 4 } },
    { op: 'update_item', item: 'Service', name: 'Billing service', icon: 'server', description: '' },
    { op: 'move_item', item: 'service', tile: { x: 3, y: -3 } },
    { op: 'update_connector', connector: 'gateway-to-service', label: '', color: 'red', style: 'SOLID' },
    { op: 'update_region', region: 'region', from: { x: -1, y: -4 }, to: { x: 4, y: 1 } },
    { op: 'update_text', text: 'text', content: 'Final', orientation: 'Y' }
  ]);
  const model = accepted(built);
  const { items, connectors, regions, texts } = describeView(model, model.views[0]);

  expect({ items, connectors, regions, texts }).toEqual({
    items: [
      { id: 'gateway', name: 'Gateway', icon: 'router', tile: { x: 0, y: 0 }, description: undefined },
      { id: 'service', name: 'Billing service', icon: 'server', tile: { x: 3, y: -3 }, description: undefined }
    ],
    connectors: [
      {
        id: 'gateway-to-service',
        from: 'gateway',
        to: 'service',
        label: undefined,
        style: 'SOLID',
        color: 'red',
        via: [{ x: 1, y: 2 }]
      }
    ],
    regions: [
      { id: 'region', from: { x: -1, y: -4 }, to: { x: 4, y: 1 }, color: 'green', contains: ['gateway', 'service'] }
    ],
    texts: [
      { id: 'region-label', content: 'Cluster', tile: { x: 0, y: 0 } },
      { id: 'text', content: 'Final', tile: { x: 0, y: 4 } }
    ]
  });

  const stripped = accepted(
    edit(built, [
      { op: 'remove_text', text: 'text' },
      { op: 'remove_region', region: 'region' },
      { op: 'remove_connector', connector: 'gateway-to-service' },
      { op: 'remove_item', item: 'gateway' }
    ])
  );
  const rest = describeView(stripped, stripped.views[0]);

  expect(stripped.items.map((item) => item.id)).toEqual(['service']);
  // A region's title is part of the region: removing one removes the other.
  expect({ connectors: rest.connectors, regions: rest.regions, texts: rest.texts.map((text) => text.id) }).toEqual({
    connectors: [],
    regions: [],
    texts: []
  });
});

test('moving a region carries what stands in it and leaves the rest where it was', () => {
  const built = edit(emptyModel('Ops'), [
    { op: 'add_item', name: 'Inside', tile: { x: 0, y: 0 } },
    { op: 'add_item', name: 'Neighbour', tile: { x: 1, y: 0 } },
    { op: 'add_item', name: 'Outside', tile: { x: 6, y: 0 } },
    { op: 'connect', from: 'inside', to: 'outside', via: [{ x: 1, y: 1 }] },
    { op: 'add_region', from: { x: -1, y: -1 }, to: { x: 2, y: 2 }, label: 'Zone' },
    { op: 'add_text', content: 'Elsewhere', tile: { x: 6, y: 3 } }
  ]);

  // One tile over: "Inside" lands where "Neighbour" stood, which is fine because both move.
  const moved = accepted(edit(built, [{ op: 'move_region', region: 'region', by: { x: 1, y: 0 } }]));
  const view = moved.views[0];

  expect(view.items.map((item) => [item.id, item.tile])).toEqual([
    ['inside', { x: 1, y: 0 }],
    ['neighbour', { x: 2, y: 0 }],
    ['outside', { x: 6, y: 0 }]
  ]);
  expect(view.rectangles![0]).toMatchObject({ from: { x: 0, y: -1 }, to: { x: 3, y: 2 } });
  expect(view.textBoxes!.map((text) => [text.id, text.tile])).toEqual([
    ['region-label', { x: 1, y: 1 }],
    ['text', { x: 6, y: 3 }]
  ]);
  expect(view.connectors![0].anchors[1].ref.tile).toEqual({ x: 2, y: 1 });

  // Onto something that stays behind: refused, and nothing moves.
  expect(() => edit(built, [{ op: 'move_region', region: 'region', by: { x: 5, y: 0 } }])).toThrow(/taken by "outside"/);
});

test('a region is titled, retitled and untitled through the region itself', () => {
  const bare = edit(emptyModel('Ops'), [{ op: 'add_region', from: { x: 0, y: 0 }, to: { x: 4, y: 3 } }]);
  const titles = (model: Model): string[] => model.views[0].textBoxes!.map((text) => `${text.id}=${text.content}`);

  const titled = edit(bare, [{ op: 'update_region', region: 'region', label: 'Edge' }]);
  const retitled = edit(titled, [{ op: 'update_region', region: 'region', label: 'Core' }]);
  const untitled = edit(retitled, [{ op: 'update_region', region: 'region', label: '' }]);

  expect(titles(bare)).toEqual([]);
  expect(titles(accepted(titled))).toEqual(['region-label=Edge']);
  expect(titles(retitled)).toEqual(['region-label=Core']);
  expect(titles(untitled)).toEqual([]);
});
test('a group that lists its nodes is rejected instead of silently producing no region', () => {
  // Membership is set on the node. Listing nodes on the group is the natural misreading, and
  // stripping it would build the diagram with no region and no complaint.
  expect(() =>
    diagramSpecSchema.parse({
      nodes: [
        { id: 'a', name: 'A', icon: 'server' },
        { id: 'b', name: 'B', icon: 'storage' }
      ],
      groups: [{ id: 'zone', name: 'Zone', nodes: ['a', 'b'] }]
    })
  ).toThrow();

  const ok = buildDiagram(
    emptyModel('Shop'),
    undefined,
    diagramSpecSchema.parse({
      nodes: [
        { id: 'a', name: 'A', icon: 'server', group: 'zone' },
        { id: 'b', name: 'B', icon: 'storage', group: 'zone' }
      ],
      groups: [{ id: 'zone', name: 'Zone' }]
    })
  ).model;
  expect(describeView(ok, ok.views[0]).regions).toHaveLength(1);
});
