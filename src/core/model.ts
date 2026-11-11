import { resolveIcon } from './icons';
import { slug, uniqueId } from './ids';
import { layoutGraph } from './layout';
import type { DiagramSpec, Operation } from './operations';
import { textBoxSpan, textToHtml } from './text';
import { CONNECTOR_COLOR, GROUP_COLORS, PALETTE, REGION_COLOR } from './theme';
import type { AnchorRef, Connector, ConnectorStyle, Coords, Model, View } from './types';

/** A request the diagram cannot satisfy; the message is written for the caller to act on. */
export class DiagramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiagramError';
  }
}

export const COLOR_NAMES: readonly string[] = PALETTE.map((entry) => entry.name);

/** How tools name a palette entry: its palette name while it still holds that colour, else its value. */
export function colorName(model: Model, id: string): string {
  const value = model.colors.find((color) => color.id === id)?.value.toLowerCase();
  const named = PALETTE.find((entry) => entry.id === id);
  if (named && (value === undefined || value === named.value || ('upstream' in named && value === named.upstream))) {
    return named.name;
  }
  return value ?? id;
}

/** Items added without an icon get the editor's generic block, so they are never invisible. */
const DEFAULT_ICON = 'block';
/** Label stalk height the editor gives items it places itself. */
const LABEL_HEIGHT = 80;
/** Lattice step used when an item is added without a tile. */
const ITEM_GAP = 3;
const REGION_PAD = 1;
const REGION_LABEL_FONT_SIZE = 0.6;

export function emptyModel(title: string, description?: string): Model {
  const model: Model = {
    version: '',
    title,
    items: [],
    views: [
      { id: 'overview', name: 'Overview', items: [], connectors: [], rectangles: [], textBoxes: [] }
    ],
    icons: [],
    colors: PALETTE.map(({ id, value }) => ({ id, value }))
  };
  if (description) model.description = description;
  return model;
}

/** Find a view by id or, failing that, by unique name. Omitting `ref` selects the first view. */
export function findView(model: Model, ref?: string): View {
  if (ref === undefined) {
    const first = model.views[0];
    if (!first) throw new DiagramError('The project has no views.');
    return first;
  }
  const byId = model.views.find((view) => view.id === ref);
  if (byId) return byId;
  const byName = model.views.filter((view) => view.name.toLowerCase() === ref.toLowerCase());
  if (byName.length === 1) return byName[0];
  const known = model.views.map((view) => `${view.id} ("${view.name}")`).join(', ');
  throw new DiagramError(`Unknown view "${ref}". Views: ${known || 'none'}.`);
}

/** Model items exist to be shown; one that no view places is unreachable in the editor. */
function pruneOrphanItems(draft: Model): void {
  const placed = new Set(draft.views.flatMap((view) => view.items.map((item) => item.id)));
  draft.items = draft.items.filter((item) => placed.has(item.id));
}

export function createView(
  model: Model,
  input: { name: string; description?: string; copyFrom?: string }
): { model: Model; viewId: string } {
  const draft = structuredClone(model);
  const id = uniqueId(
    slug(input.name),
    draft.views.map((view) => view.id)
  );
  const view: View =
    input.copyFrom === undefined
      ? { id, name: input.name, items: [], connectors: [], rectangles: [], textBoxes: [] }
      : { ...structuredClone(findView(draft, input.copyFrom)), id, name: input.name };
  if (input.description !== undefined) view.description = input.description;
  delete view.lastUpdated;
  draft.views.push(view);
  return { model: draft, viewId: id };
}

export function updateView(
  model: Model,
  viewRef: string,
  patch: { name?: string; description?: string }
): Model {
  const draft = structuredClone(model);
  const view = findView(draft, viewRef);
  if (patch.name !== undefined) view.name = patch.name;
  if (patch.description !== undefined) view.description = patch.description;
  return draft;
}

export function deleteView(model: Model, viewRef: string): Model {
  const draft = structuredClone(model);
  const view = findView(draft, viewRef);
  if (draft.views.length === 1) {
    throw new DiagramError(`"${view.name}" is the only view; a project keeps at least one.`);
  }
  draft.views = draft.views.filter((candidate) => candidate.id !== view.id);
  pruneOrphanItems(draft);
  return draft;
}

function requireIcon(draft: Model, icon: string | undefined): void {
  if (icon !== undefined && !resolveIcon(draft, icon)) {
    throw new DiagramError(`Unknown icon "${icon}". Search the icon catalog for a valid id.`);
  }
}

/** Resolve a colour reference to a palette id, adding named and hex colours on first use. */
function colorId(draft: Model, ref: string): string {
  const wanted = ref.toLowerCase();
  const existing = draft.colors.find((color) => color.id === ref || color.value.toLowerCase() === wanted);
  if (existing) return existing.id;
  const named = PALETTE.find((entry) => entry.name === wanted);
  if (named) {
    const { id, value } = named;
    if (!draft.colors.some((color) => color.id === id)) draft.colors.push({ id, value });
    return id;
  }
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(wanted)) {
    const id = uniqueId(
      `color-${wanted.slice(1)}`,
      draft.colors.map((color) => color.id)
    );
    draft.colors.push({ id, value: wanted });
    return id;
  }
  throw new DiagramError(
    `Unknown colour "${ref}". Use ${COLOR_NAMES.join(', ')}, a palette id, or a hex value like #ff8800.`
  );
}

/** Resolve an item reference to the id of an item placed in `view`. */
function placedItemId(draft: Model, view: View, ref: string): string {
  const placed = new Set(view.items.map((item) => item.id));
  if (placed.has(ref)) return ref;
  const named = draft.items.filter(
    (item) => placed.has(item.id) && item.name.toLowerCase() === ref.toLowerCase()
  );
  if (named.length === 1) return named[0].id;
  if (named.length > 1) {
    throw new DiagramError(
      `"${ref}" names ${named.length} items in view "${view.name}"; use an id: ${named.map((item) => item.id).join(', ')}.`
    );
  }
  throw new DiagramError(
    `No item "${ref}" in view "${view.name}". Items here: ${[...placed].join(', ') || 'none'}.`
  );
}

/** Nearest unoccupied lattice tile around the most recently added item, preferring -y then +x. */
function freeTile(view: View): Coords {
  const near = view.items.at(-1)?.tile;
  if (!near) return { x: 0, y: 0 };
  const occupied = new Set(view.items.map((item) => `${item.tile.x},${item.tile.y}`));
  for (let ring = 1; ; ring++) {
    const candidates: Coords[] = [];
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        candidates.push({ x: near.x + dx * ITEM_GAP, y: near.y + dy * ITEM_GAP });
      }
    }
    const distance = (tile: Coords): number => Math.abs(tile.x - near.x) + Math.abs(tile.y - near.y);
    candidates.sort((a, b) => distance(a) - distance(b) || a.y - b.y || b.x - a.x);
    const free = candidates.find((tile) => !occupied.has(`${tile.x},${tile.y}`));
    if (free) return free;
  }
}

function claimTile(view: View, tile: Coords | undefined, movingId?: string): Coords {
  if (tile === undefined) return freeTile(view);
  const occupant = view.items.find(
    (item) => item.id !== movingId && item.tile.x === tile.x && item.tile.y === tile.y
  );
  if (occupant) {
    throw new DiagramError(`Tile (${tile.x}, ${tile.y}) is taken by "${occupant.id}".`);
  }
  return tile;
}

/** Remove matching connectors, and then any connector left anchored to one of theirs. */
function dropConnectors(view: View, doomed: (connector: Connector) => boolean): void {
  let connectors = (view.connectors ?? []).filter((connector) => !doomed(connector));
  for (;;) {
    const anchorIds = new Set(connectors.flatMap((connector) => connector.anchors.map((anchor) => anchor.id)));
    const kept = connectors.filter((connector) =>
      connector.anchors.every((anchor) => anchor.ref.anchor === undefined || anchorIds.has(anchor.ref.anchor))
    );
    if (kept.length === connectors.length) break;
    connectors = kept;
  }
  view.connectors = connectors;
}

function addConnector(
  draft: Model,
  view: View,
  input: {
    from: string;
    to: string;
    label?: string;
    color?: string;
    style?: ConnectorStyle;
    width?: number;
    via?: Coords[];
  }
): string {
  const connectors = (view.connectors ??= []);
  const id = uniqueId(
    `${input.from}-to-${input.to}`,
    connectors.map((connector) => connector.id)
  );
  const refs: AnchorRef[] = [
    { item: input.from },
    ...(input.via ?? []).map((tile) => ({ tile })),
    { item: input.to }
  ];
  const connector: Connector = {
    id,
    anchors: refs.map((ref, index) => ({ id: `${id}:${index}`, ref }))
  };
  connector.color = colorId(draft, input.color ?? CONNECTOR_COLOR);
  if (input.label) connector.description = input.label;
  if (input.style !== undefined) connector.style = input.style;
  if (input.width !== undefined) connector.width = input.width;
  connectors.push(connector);
  return id;
}

/** Add a rectangle and, when titled, a text box along its upper-left edge. */
function addRegion(
  draft: Model,
  view: View,
  input: { id: string; from: Coords; to: Coords; label?: string; color?: string; titleTile?: Coords }
): void {
  const from = { x: Math.min(input.from.x, input.to.x), y: Math.min(input.from.y, input.to.y) };
  const to = { x: Math.max(input.from.x, input.to.x), y: Math.max(input.from.y, input.to.y) };
  (view.rectangles ??= []).push({ id: input.id, color: colorId(draft, input.color ?? REGION_COLOR), from, to });
  if (input.label) {
    const texts = (view.textBoxes ??= []);
    // The title sits on its own row inside the region's upper edge, so it never collides with a
    // node label or a connector.
    const titleTile = input.titleTile ?? { x: from.x + REGION_PAD, y: to.y - REGION_PAD };
    texts.push({
      id: uniqueId(
        `${input.id}-label`,
        texts.map((text) => text.id)
      ),
      tile: titleTile,
      content: input.label,
      fontSize: REGION_LABEL_FONT_SIZE,
      orientation: 'X'
    });
  }
}

/**
 * Re-place everything in a view. Regions become groups (an item belongs to the smallest region
 * containing it), a text box on a region's title row moves with it, and waypoints between items
 * are dropped because they no longer mean anything.
 */
function relayout(view: View): void {
  const regions = (view.rectangles ?? []).map((rectangle) => ({
    rectangle,
    lowX: Math.min(rectangle.from.x, rectangle.to.x),
    highX: Math.max(rectangle.from.x, rectangle.to.x),
    lowY: Math.min(rectangle.from.y, rectangle.to.y),
    highY: Math.max(rectangle.from.y, rectangle.to.y)
  }));
  const titled = regions.map((region) => {
    // Titles are named after their region; older layouts also kept them just outside the top edge,
    // so geometry is the fallback.
    const texts = view.textBoxes ?? [];
    const title =
      texts.find((text) => text.id === `${region.rectangle.id}-label`) ??
      texts.find(
        (text) =>
          text.orientation !== 'Y' &&
          text.tile.x >= region.lowX &&
          text.tile.x <= region.highX &&
          text.tile.y >= region.highY - 1 &&
          text.tile.y <= region.highY + 1
      );
    return { ...region, title };
  });
  const smallestFirst = [...titled].sort(
    (a, b) =>
      (a.highX - a.lowX + 1) * (a.highY - a.lowY + 1) - (b.highX - b.lowX + 1) * (b.highY - b.lowY + 1)
  );

  const nodes = view.items.map((item) => ({
    id: item.id,
    group: smallestFirst.find(
      (region) =>
        item.tile.x >= region.lowX &&
        item.tile.x <= region.highX &&
        item.tile.y >= region.lowY &&
        item.tile.y <= region.highY
    )?.rectangle.id
  }));
  const edges = (view.connectors ?? []).flatMap((connector) => {
    const from = connector.anchors[0]?.ref.item;
    const to = connector.anchors.at(-1)?.ref.item;
    return from !== undefined && to !== undefined && from !== to ? [{ from, to }] : [];
  });
  const layout = layoutGraph({
    nodes,
    edges,
    groups: titled.map((region) => ({
      id: region.rectangle.id,
      labelSpan: region.title
        ? Math.ceil(textBoxSpan(region.title.content, region.title.fontSize ?? REGION_LABEL_FONT_SIZE))
        : 0
    }))
  });

  for (const item of view.items) item.tile = layout.tiles.get(item.id)!;
  for (const region of titled) {
    const placed = layout.regions.get(region.rectangle.id);
    if (!placed) continue;
    region.rectangle.from = placed.from;
    region.rectangle.to = placed.to;
    if (region.title) region.title.tile = placed.titleTile;
  }
  const referenced = new Set(
    (view.connectors ?? []).flatMap((connector) =>
      connector.anchors.flatMap((anchor) => (anchor.ref.anchor === undefined ? [] : [anchor.ref.anchor]))
    )
  );
  for (const connector of view.connectors ?? []) {
    if (connector.anchors[0]?.ref.item === undefined || connector.anchors.at(-1)?.ref.item === undefined) continue;
    connector.anchors = connector.anchors.filter(
      (anchor) => anchor.ref.tile === undefined || referenced.has(anchor.id)
    );
  }
}

function applyOperation(draft: Model, view: View, op: Operation): string {
  switch (op.op) {
    case 'add_item': {
      const ids = draft.items.map((item) => item.id);
      if (op.id !== undefined && ids.includes(op.id)) {
        throw new DiagramError(
          `Item id "${op.id}" already exists. Use place_item to show it in this view or update_item to change it.`
        );
      }
      requireIcon(draft, op.icon);
      const id = op.id ?? uniqueId(slug(op.name), ids);
      const tile = claimTile(view, op.tile);
      draft.items.push({
        id,
        name: op.name,
        icon: op.icon ?? DEFAULT_ICON,
        ...(op.description ? { description: textToHtml(op.description) } : {})
      });
      view.items.push({ id, tile, labelHeight: LABEL_HEIGHT });
      return `Added item "${id}" at (${tile.x}, ${tile.y}).`;
    }
    case 'place_item': {
      if (!draft.items.some((item) => item.id === op.item)) {
        throw new DiagramError(
          `No item with id "${op.item}" in the project. Items: ${draft.items.map((item) => item.id).join(', ') || 'none'}.`
        );
      }
      if (view.items.some((item) => item.id === op.item)) {
        throw new DiagramError(`Item "${op.item}" is already in view "${view.name}"; use move_item.`);
      }
      const tile = claimTile(view, op.tile);
      view.items.push({ id: op.item, tile, labelHeight: LABEL_HEIGHT });
      return `Placed item "${op.item}" at (${tile.x}, ${tile.y}).`;
    }
    case 'update_item': {
      const id = placedItemId(draft, view, op.item);
      requireIcon(draft, op.icon);
      const item = draft.items.find((candidate) => candidate.id === id)!;
      if (op.name !== undefined) item.name = op.name;
      if (op.icon !== undefined) item.icon = op.icon;
      if (op.description === '') delete item.description;
      else if (op.description !== undefined) item.description = textToHtml(op.description);
      return `Updated item "${id}".`;
    }
    case 'move_item': {
      const id = placedItemId(draft, view, op.item);
      view.items.find((item) => item.id === id)!.tile = claimTile(view, op.tile, id);
      return `Moved item "${id}" to (${op.tile.x}, ${op.tile.y}).`;
    }
    case 'remove_item': {
      const id = placedItemId(draft, view, op.item);
      for (const target of op.everywhere ? draft.views : [view]) {
        target.items = target.items.filter((item) => item.id !== id);
        dropConnectors(target, (connector) => connector.anchors.some((anchor) => anchor.ref.item === id));
      }
      return `Removed item "${id}" from ${op.everywhere ? 'every view' : `view "${view.name}"`}.`;
    }
    case 'connect': {
      const from = placedItemId(draft, view, op.from);
      const to = placedItemId(draft, view, op.to);
      if (from === to) throw new DiagramError(`Cannot connect "${from}" to itself.`);
      const id = addConnector(draft, view, { ...op, from, to });
      return `Connected "${from}" to "${to}" as connector "${id}".`;
    }
    case 'update_connector': {
      const connector = (view.connectors ?? []).find((candidate) => candidate.id === op.connector);
      if (!connector) throw unknown('connector', op.connector, view.connectors);
      if (op.label === '') delete connector.description;
      else if (op.label !== undefined) connector.description = op.label;
      if (op.color !== undefined) connector.color = colorId(draft, op.color);
      if (op.style !== undefined) connector.style = op.style;
      if (op.width !== undefined) connector.width = op.width;
      return `Updated connector "${connector.id}".`;
    }
    case 'remove_connector': {
      if (!(view.connectors ?? []).some((connector) => connector.id === op.connector)) {
        throw unknown('connector', op.connector, view.connectors);
      }
      dropConnectors(view, (connector) => connector.id === op.connector);
      return `Removed connector "${op.connector}".`;
    }
    case 'add_region': {
      let from = op.from;
      let to = op.to;
      if (op.items) {
        const tiles = op.items.map(
          (ref) => view.items.find((item) => item.id === placedItemId(draft, view, ref))!.tile
        );
        from = {
          x: Math.min(...tiles.map((tile) => tile.x)) - REGION_PAD,
          y: Math.min(...tiles.map((tile) => tile.y)) - REGION_PAD
        };
        to = {
          x: Math.max(...tiles.map((tile) => tile.x)) + REGION_PAD,
          y: Math.max(...tiles.map((tile) => tile.y)) + REGION_PAD
        };
      }
      if (!from || !to) throw new DiagramError('A region needs either `items` or both `from` and `to`.');
      const id = uniqueId(
        'region',
        (view.rectangles ?? []).map((rectangle) => rectangle.id)
      );
      addRegion(draft, view, { id, from, to, label: op.label, color: op.color });
      return `Added region "${id}" from (${from.x}, ${from.y}) to (${to.x}, ${to.y}).`;
    }
    case 'update_region': {
      const region = (view.rectangles ?? []).find((candidate) => candidate.id === op.region);
      if (!region) throw unknown('region', op.region, view.rectangles);
      if (op.from) region.from = op.from;
      if (op.to) region.to = op.to;
      if (op.color !== undefined) region.color = colorId(draft, op.color);
      return `Updated region "${region.id}".`;
    }
    case 'remove_region': {
      if (!(view.rectangles ?? []).some((rectangle) => rectangle.id === op.region)) {
        throw unknown('region', op.region, view.rectangles);
      }
      view.rectangles = view.rectangles!.filter((rectangle) => rectangle.id !== op.region);
      return `Removed region "${op.region}".`;
    }
    case 'add_text': {
      const texts = (view.textBoxes ??= []);
      const id = uniqueId(
        'text',
        texts.map((text) => text.id)
      );
      texts.push({
        id,
        tile: op.tile,
        content: op.content,
        ...(op.fontSize === undefined ? {} : { fontSize: op.fontSize }),
        ...(op.orientation === undefined ? {} : { orientation: op.orientation })
      });
      return `Added text "${id}" at (${op.tile.x}, ${op.tile.y}).`;
    }
    case 'update_text': {
      const text = (view.textBoxes ?? []).find((candidate) => candidate.id === op.text);
      if (!text) throw unknown('text', op.text, view.textBoxes);
      if (op.content !== undefined) text.content = op.content;
      if (op.tile) text.tile = op.tile;
      if (op.fontSize !== undefined) text.fontSize = op.fontSize;
      if (op.orientation !== undefined) text.orientation = op.orientation;
      return `Updated text "${text.id}".`;
    }
    case 'remove_text': {
      if (!(view.textBoxes ?? []).some((text) => text.id === op.text)) {
        throw unknown('text', op.text, view.textBoxes);
      }
      view.textBoxes = view.textBoxes!.filter((text) => text.id !== op.text);
      return `Removed text "${op.text}".`;
    }
    case 'auto_layout': {
      relayout(view);
      return `Re-laid out ${view.items.length} items in view "${view.name}".`;
    }
  }
}

function unknown(kind: string, id: string, known: { id: string }[] | undefined): DiagramError {
  const ids = (known ?? []).map((entry) => entry.id).join(', ');
  return new DiagramError(`Unknown ${kind} "${id}". Known: ${ids || 'none'}.`);
}

/**
 * Apply edits to one view, all or nothing: the first failing operation aborts the batch and the
 * input model is left untouched.
 */
export function applyOperations(
  model: Model,
  viewRef: string | undefined,
  operations: Operation[]
): { model: Model; viewId: string; results: string[] } {
  const draft = structuredClone(model);
  const view = findView(draft, viewRef);
  const results = operations.map((operation, index) => {
    try {
      return applyOperation(draft, view, operation);
    } catch (error) {
      if (!(error instanceof DiagramError)) throw error;
      throw new DiagramError(`Operation ${index + 1} (${operation.op}): ${error.message}`);
    }
  });
  pruneOrphanItems(draft);
  return { model: draft, viewId: view.id, results };
}

/**
 * Replace a view's content with a declarative graph, laid out automatically. Node ids are item
 * ids, so re-running with an edited spec updates the same items, including in other views.
 */
export function buildDiagram(
  model: Model,
  viewRef: string | undefined,
  spec: DiagramSpec
): { model: Model; viewId: string } {
  const draft = structuredClone(model);
  const view = findView(draft, viewRef);

  const nodeIds = new Set<string>();
  for (const node of spec.nodes) {
    if (nodeIds.has(node.id)) throw new DiagramError(`Duplicate node id "${node.id}".`);
    nodeIds.add(node.id);
    requireIcon(draft, node.icon);
  }
  const groupIds = new Set<string>();
  for (const group of spec.groups) {
    if (groupIds.has(group.id)) throw new DiagramError(`Duplicate group id "${group.id}".`);
    groupIds.add(group.id);
  }
  for (const node of spec.nodes) {
    if (node.group !== undefined && !groupIds.has(node.group)) {
      throw new DiagramError(`Node "${node.id}" names unknown group "${node.group}".`);
    }
  }
  for (const edge of spec.edges) {
    for (const end of [edge.from, edge.to]) {
      if (!nodeIds.has(end)) {
        throw new DiagramError(`Edge ${edge.from} -> ${edge.to} names unknown node "${end}".`);
      }
    }
    if (edge.from === edge.to) throw new DiagramError(`Edge ${edge.from} -> ${edge.to} connects a node to itself.`);
  }

  const layout = layoutGraph({
    nodes: spec.nodes,
    edges: spec.edges,
    groups: spec.groups.map((group) => ({
      id: group.id,
      labelSpan: Math.ceil(textBoxSpan(group.name, REGION_LABEL_FONT_SIZE))
    }))
  });

  for (const node of spec.nodes) {
    const item = {
      id: node.id,
      name: node.name,
      icon: node.icon ?? DEFAULT_ICON,
      ...(node.description ? { description: textToHtml(node.description) } : {})
    };
    const index = draft.items.findIndex((candidate) => candidate.id === node.id);
    if (index === -1) draft.items.push(item);
    else draft.items[index] = item;
  }
  view.items = spec.nodes.map((node) => ({
    id: node.id,
    tile: layout.tiles.get(node.id)!,
    labelHeight: LABEL_HEIGHT
  }));
  view.connectors = [];
  for (const edge of spec.edges) addConnector(draft, view, edge);
  view.rectangles = [];
  view.textBoxes = [];
  spec.groups.forEach((group, index) => {
    const region = layout.regions.get(group.id);
    if (!region) return;
    addRegion(draft, view, {
      id: group.id,
      from: region.from,
      to: region.to,
      titleTile: region.titleTile,
      label: group.name,
      color: group.color ?? GROUP_COLORS[index % GROUP_COLORS.length]
    });
  });
  pruneOrphanItems(draft);
  return { model: draft, viewId: view.id };
}
