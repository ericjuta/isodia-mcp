import { z } from 'zod';
import { catalogIcon } from './icons';
import { CONNECTOR_STYLES, type Model } from './types';

/**
 * What a diagram model must look like to be stored, drawn or edited. The shape is the Isoflow
 * model format, so files travel both ways; the rules are ours, and stricter: tiles are whole
 * numbers, ids are unique where they are looked up, and every reference resolves.
 */

const id = z.string().min(1);
const name = z.string().max(100);
const coords = z.object({ x: z.number().int(), y: z.number().int() });

/**
 * A custom icon carries its picture inline. A path or a remote address is refused: the PNG
 * renderer would read a path off the server's disk, and a viewer's browser would fetch the address.
 */
const iconUrl = z
  .string()
  .regex(/^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/, 'An icon url must be an inline data:image/… URL.');

const icon = z.object({
  id,
  name,
  url: iconUrl,
  collection: z.string().optional(),
  isIsometric: z.boolean().optional()
});

const color = z.object({ id, value: z.string().max(7) });

const modelItem = z.object({
  id,
  name,
  description: z.string().optional(),
  icon: id.optional()
});

const viewItem = z.object({
  id,
  tile: coords,
  labelHeight: z.number().optional()
});

const anchor = z.object({
  id,
  ref: z.object({
    item: id.optional(),
    anchor: id.optional(),
    tile: coords.optional()
  })
});

const connector = z.object({
  id,
  description: z.string().optional(),
  color: id.optional(),
  width: z.number().positive().optional(),
  style: z.enum(CONNECTOR_STYLES).optional(),
  anchors: z.array(anchor)
});

const rectangle = z.object({
  id,
  color: id.optional(),
  from: coords,
  to: coords
});

const textBox = z.object({
  id,
  tile: coords,
  content: name,
  fontSize: z.number().positive().optional(),
  orientation: z.enum(['X', 'Y']).optional()
});

const view = z.object({
  id,
  lastUpdated: z.iso.datetime().optional(),
  name,
  description: z.string().optional(),
  items: z.array(viewItem),
  rectangles: z.array(rectangle).optional(),
  connectors: z.array(connector).optional(),
  textBoxes: z.array(textBox).optional()
});

const modelShape = z.object({
  version: z.string().max(10).optional(),
  title: name,
  description: z.string().optional(),
  items: z.array(modelItem),
  views: z.array(view),
  icons: z.array(icon),
  colors: z.array(color)
});

type Path = (string | number)[];
type Report = (path: Path, message: string) => void;

function requireUnique(entries: { id: string }[], path: Path, what: string, report: Report): void {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.id)) report([...path, index, 'id'], `Duplicate ${what} id "${entry.id}".`);
    seen.add(entry.id);
  });
}

/** Every reference in the model must land on something the model holds. */
function checkReferences(model: z.infer<typeof modelShape>, report: Report): void {
  requireUnique(model.items, ['items'], 'item', report);
  requireUnique(model.views, ['views'], 'view', report);
  requireUnique(model.icons, ['icons'], 'icon', report);
  requireUnique(model.colors, ['colors'], 'colour', report);

  const iconIds = new Set(model.icons.map((entry) => entry.id));
  model.items.forEach((item, index) => {
    if (item.icon !== undefined && !iconIds.has(item.icon) && !catalogIcon(item.icon)) {
      report(
        ['items', index, 'icon'],
        `Item "${item.id}" names icon "${item.icon}", which is neither in the catalog nor carried in "icons".`
      );
    }
  });

  const itemIds = new Set(model.items.map((item) => item.id));
  const colorIds = new Set(model.colors.map((entry) => entry.id));
  model.views.forEach((entry, viewIndex) => {
    const at: Path = ['views', viewIndex];
    requireUnique(entry.items, [...at, 'items'], 'placed item', report);
    requireUnique(entry.connectors ?? [], [...at, 'connectors'], 'connector', report);
    requireUnique(entry.rectangles ?? [], [...at, 'rectangles'], 'region', report);
    requireUnique(entry.textBoxes ?? [], [...at, 'textBoxes'], 'text', report);

    entry.items.forEach((placed, index) => {
      if (!itemIds.has(placed.id)) {
        report([...at, 'items', index, 'id'], `View "${entry.id}" places item "${placed.id}", which the model does not have.`);
      }
    });

    const placedIds = new Set(entry.items.map((placed) => placed.id));
    const anchorIds = new Set((entry.connectors ?? []).flatMap((line) => line.anchors.map((end) => end.id)));
    (entry.connectors ?? []).forEach((line, lineIndex) => {
      const lineAt: Path = [...at, 'connectors', lineIndex];
      if (line.anchors.length < 2) {
        report([...lineAt, 'anchors'], `Connector "${line.id}" needs at least two anchors: a source and a target.`);
      }
      if (line.color !== undefined && !colorIds.has(line.color)) {
        report([...lineAt, 'color'], `Connector "${line.id}" names colour "${line.color}", which the model does not have.`);
      }
      line.anchors.forEach((end, endIndex) => {
        const endAt: Path = [...lineAt, 'anchors', endIndex, 'ref'];
        const set = [end.ref.item, end.ref.anchor, end.ref.tile].filter((value) => value !== undefined).length;
        if (set !== 1) {
          report(endAt, `Anchor "${end.id}" must reference exactly one of an item, another anchor or a tile.`);
          return;
        }
        if (end.ref.item !== undefined && !placedIds.has(end.ref.item)) {
          report(endAt, `Anchor "${end.id}" references item "${end.ref.item}", which is not in view "${entry.id}".`);
        }
        if (end.ref.anchor !== undefined && !anchorIds.has(end.ref.anchor)) {
          report(endAt, `Anchor "${end.id}" references anchor "${end.ref.anchor}", which is not in view "${entry.id}".`);
        }
      });
    });

    (entry.rectangles ?? []).forEach((region, index) => {
      if (region.color !== undefined && !colorIds.has(region.color)) {
        report(
          [...at, 'rectangles', index, 'color'],
          `Region "${region.id}" names colour "${region.color}", which the model does not have.`
        );
      }
    });
  });
}

export class ModelValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid diagram model: ${issues.join(' | ')}`);
    this.name = 'ModelValidationError';
  }
}

/**
 * Validate a model and return its parsed form: unknown keys dropped and keys in schema order,
 * so equal models serialise identically. Catalog icons resolve without being carried in the
 * model, which is how the bundled catalog stays out of stored projects.
 * Throws `ModelValidationError` listing every problem found.
 */
export function parseModel(model: unknown): Model {
  const shaped = modelShape.safeParse(model);
  if (!shaped.success) {
    throw new ModelValidationError(
      shaped.error.issues.map((issue) => `${issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}${issue.message}`)
    );
  }
  const issues: string[] = [];
  checkReferences(shaped.data, (path, message) => issues.push(`${path.join('.')}: ${message}`));
  if (issues.length > 0) throw new ModelValidationError(issues);
  return shaped.data;
}
