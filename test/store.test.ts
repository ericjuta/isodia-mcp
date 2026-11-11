import { expect, test } from 'bun:test';
import { catalogIcon } from '../src/core/icons';
import { ModelValidationError } from '../src/core/schema';
import type { Model } from '../src/core/types';
import { ConflictError, NotFoundError, type RevisionSource, Store } from '../src/server/store';

function open(): { store: Store; advance(ms: number): void } {
  let time = Date.parse('2026-01-01T00:00:00Z');
  return {
    store: new Store(':memory:', { now: () => new Date(time) }),
    advance: (ms) => {
      time += ms;
    }
  };
}

/** A distinct change per call: sets the project description. */
const describeAs = (store: Store, id: string, text: string, source: RevisionSource) =>
  store.updateModel(id, { source, summary: text }, (model) => ({ ...model, description: text }));

const history = (store: Store, id: string): number[] => store.listRevisions(id).map((revision) => revision.number);


test('saving an equal model with its keys in another order records nothing', () => {
  const { store } = open();
  const project = store.createProject({ name: 'Shop' }, 'api');
  const reordered = Object.fromEntries(Object.entries(project.model).reverse()) as unknown as Model;

  const saved = store.updateModel(project.id, { source: 'editor', summary: 'reload' }, () => reordered);

  expect(saved.revision).toBe(1);
  expect(history(store, project.id)).toEqual([1]);
});

test('a stale base revision is refused and reports the current one', () => {
  const { store } = open();
  const { id } = store.createProject({ name: 'Shop' }, 'api');
  describeAs(store, id, 'from the agent', 'mcp');

  let reported: number | undefined;
  try {
    store.updateModel(id, { source: 'editor', summary: 'stale', expectedRevision: 1 }, (model) => ({
      ...model,
      description: 'from a stale editor'
    }));
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    reported = error.currentRevision;
  }

  expect(reported).toBe(2);
  expect(store.getProject(id).model.description).toBe('from the agent');
});

test('editor autosaves collapse to one revision per burst; named revisions and other sources stand alone', () => {
  const { store, advance } = open();
  const { id } = store.createProject({ name: 'Shop' }, 'api');

  describeAs(store, id, 'a', 'editor');
  advance(30_000);
  describeAs(store, id, 'b', 'editor');
  advance(30_000);
  describeAs(store, id, 'c', 'editor');
  expect(history(store, id)).toEqual([4, 1]);

  advance(120_000);
  describeAs(store, id, 'd', 'editor');
  expect(history(store, id)).toEqual([5, 4, 1]);

  store.labelCurrentRevision(id, 'before launch');
  describeAs(store, id, 'e', 'editor');
  expect(history(store, id)).toEqual([6, 5, 4, 1]);

  describeAs(store, id, 'f', 'mcp');
  describeAs(store, id, 'g', 'mcp');
  expect(history(store, id)).toEqual([8, 7, 6, 5, 4, 1]);
});

test('restoring brings an old model back as a new revision and keeps the one it replaced', () => {
  const { store } = open();
  const { id } = store.createProject({ name: 'Shop' }, 'api');
  describeAs(store, id, 'second thoughts', 'mcp');

  const restored = store.restoreRevision(id, 1);

  expect(restored.revision).toBe(3);
  expect(restored.model).toEqual(store.getRevisionModel(id, 1));
  expect(store.getRevisionModel(id, 2).description).toBe('second thoughts');
  expect(store.listRevisions(id)[0]).toMatchObject({ number: 3, source: 'restore', summary: 'Restored revision 1' });
});

test('old unnamed revisions are pruned, but the original and named revisions stay restorable', () => {
  const { store } = open();
  const { id } = store.createProject({ name: 'Shop' }, 'api');

  // A long editing session: far more revisions than the retention window.
  store.updateModel(id, { source: 'mcp', summary: 'a milestone' }, (model) => ({ ...model, description: 'keep me' }));
  store.labelCurrentRevision(id, 'milestone');
  for (let i = 0; i < 150; i++) describeAs(store, id, `edit ${i}`, 'mcp');

  const kept = history(store, id);
  expect(kept.length).toBe(102); // window + the labelled revision + the original
  expect(kept).toContain(1);
  expect(kept).toContain(2); // the named milestone survives pruning
  expect(kept[0]).toBe(store.getProject(id).revision);

  // The old models are genuinely still readable, not just their numbers.
  expect(store.getRevisionModel(id, 1)).toBeDefined();
  expect(store.getRevisionModel(id, 2).description).toBe('keep me');
  expect(store.restoreRevision(id, 2).model.description).toBe('keep me');

  // The retained window is fully restorable: restoring re-reads revision 2 after a prune.
  const afterRestore = history(store, id);
  expect(afterRestore[0]).toBe(store.getProject(id).revision);
  for (const number of afterRestore) expect(store.getRevisionModel(id, number)).toBeDefined();
  expect(afterRestore).toContain(2);
});

test('restoring a pruned revision explains the range instead of listing every number', () => {
  const { store } = open();
  const { id } = store.createProject({ name: 'Shop' }, 'api');
  for (let i = 0; i < 130; i++) describeAs(store, id, `edit ${i}`, 'mcp');

  let message = '';
  try {
    store.restoreRevision(id, 5);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    message = error.message;
  }

  expect(message).toContain('was pruned');
  expect(message).toContain('Available:');
  // The message stays readable: an agent or a person should not get ~100 numbers back.
  expect(message.length).toBeLessThan(160);
});

test('an invalid model is rejected and the project is untouched', () => {
  const { store } = open();
  const { id } = store.createProject({ name: 'Shop' }, 'api');

  expect(() =>
    store.updateModel(id, { source: 'api', summary: 'bad' }, (model) => ({
      ...model,
      items: [{ id: 'ghost', name: 'Ghost', icon: 'no-such-icon' }]
    }))
  ).toThrow(ModelValidationError);
  expect(store.getProject(id)).toMatchObject({ revision: 1, model: { items: [] } });
});

test('catalog icons are not stored; custom icons are', () => {
  const { store } = open();
  const { id } = store.createProject({ name: 'Shop' }, 'api');

  const saved = store.updateModel(id, { source: 'editor', summary: 'icons' }, (model) => ({
    ...model,
    icons: [catalogIcon('server')!, { id: 'logo', name: 'Logo', url: 'data:image/png;base64,AAAA' }],
    items: [
      { id: 's', name: 'Server', icon: 'server' },
      { id: 'l', name: 'Logo', icon: 'logo' }
    ],
    views: [
      {
        ...model.views[0],
        items: [
          { id: 's', tile: { x: 0, y: 0 } },
          { id: 'l', tile: { x: 3, y: 0 } }
        ]
      }
    ]
  }));

  expect(saved.model.icons.map((icon) => icon.id)).toEqual(['logo']);
});

test('an import with no colours or views gets a palette and a view to edit', () => {
  const { store } = open();

  const imported = store.importProject({ title: 'Legacy', items: [], views: [], icons: [], colors: [] });

  expect(imported.name).toBe('Legacy');
  expect(imported.model.views).toHaveLength(1);
  expect(imported.model.colors.length).toBeGreaterThan(0);
});

test('an import keeps the features a hand-built file relies on', () => {
  const { store } = open();
  const icon = 'data:image/svg+xml;base64,PHN2Zy8+';

  // Written the way another tool exports the format, not the way build_diagram composes one:
  // several views, a custom icon, per-item label heights, a wide dotted connector routed through a
  // waypoint tile, and a vertical text box.
  const imported = store.importProject({
    version: '1.0.0',
    title: 'Hand built',
    items: [
      { id: 'alpha', name: 'Alpha', icon: 'custom-box' },
      { id: 'beta', name: 'Beta', icon: 'cloud' }
    ],
    icons: [{ id: 'custom-box', name: 'Custom box', url: icon, collection: 'custom', isIsometric: false }],
    colors: [{ id: 'color1', value: '#a5b8f3' }],
    views: [
      {
        id: 'main',
        name: 'Main',
        items: [
          { id: 'alpha', tile: { x: 0, y: 0 }, labelHeight: 120 },
          { id: 'beta', tile: { x: 4, y: 0 }, labelHeight: 40 }
        ],
        connectors: [
          {
            id: 'alpha-beta',
            description: 'link',
            width: 8,
            style: 'DOTTED',
            anchors: [
              { id: 'a1', ref: { item: 'alpha' } },
              { id: 'a2', ref: { tile: { x: 2, y: 3 } } },
              { id: 'a3', ref: { item: 'beta' } }
            ]
          }
        ],
        rectangles: [],
        textBoxes: [{ id: 'tb', tile: { x: 6, y: 0 }, content: 'Note', fontSize: 0.5, orientation: 'Y' }]
      },
      { id: 'second', name: 'Second', items: [{ id: 'beta', tile: { x: 0, y: 0 } }], connectors: [], rectangles: [], textBoxes: [] }
    ]
  });

  const model = imported.model;
  expect(model.views.map((view) => view.id)).toEqual(['main', 'second']);
  expect(model.items.find((item) => item.id === 'alpha')?.icon).toBe('custom-box');
  // A custom icon carries its own image, so it must survive import rather than be dropped.
  expect(model.icons.find((entry) => entry.id === 'custom-box')?.url).toBe(icon);

  const main = model.views[0];
  expect(main.items.map((item) => item.labelHeight)).toEqual([120, 40]);

  const connector = main.connectors![0];
  expect(connector.width).toBe(8);
  expect(connector.style).toBe('DOTTED');
  expect(connector.anchors).toHaveLength(3);
  expect(connector.anchors[1].ref.tile).toEqual({ x: 2, y: 3 });

  expect(main.textBoxes![0].orientation).toBe('Y');
  expect(main.textBoxes![0].fontSize).toBe(0.5);
});

test('projects with the same name get distinct ids', () => {
  const { store } = open();

  const ids = [store.createProject({ name: 'Shop' }, 'api'), store.createProject({ name: 'Shop' }, 'api')].map(
    (project) => project.id
  );

  expect(ids).toEqual(['shop', 'shop-2']);
});

test('a share link resolves until revoked, and does not outlive its project', () => {
  const { store } = open();
  const { id } = store.createProject({ name: 'Shop' }, 'api');

  const first = store.createShareLink(id, 'Overview');
  expect(store.resolveShareLink(first.token)).toMatchObject({ project: { id }, viewId: 'overview' });
  store.revokeShareLink(first.token);
  expect(() => store.resolveShareLink(first.token)).toThrow(NotFoundError);

  const second = store.createShareLink(id);
  store.deleteProject(id);
  expect(() => store.resolveShareLink(second.token)).toThrow(NotFoundError);
});
