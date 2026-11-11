import { z } from 'zod';
import { CONNECTOR_STYLES } from './types';

/**
 * Input contracts for diagram edits. These schemas are the single definition shared by the
 * model operations, the REST API and the MCP tools.
 */

const tile = z
  .object({ x: z.number().int(), y: z.number().int() })
  .describe('Grid tile. In the picture +x runs toward the upper right and +y toward the upper left.');

const color = z
  .string()
  .describe(
    'Palette name (blue, purple, yellow, red, orange, green, teal, slate), a palette id, or a hex value like #ff8800. Regions default to blue and connectors to slate, a neutral grey.'
  );

const style = z.enum(CONNECTOR_STYLES);

const itemRef = z.string().describe('Item id, or its exact name when that is unambiguous in the view.');

export const operationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_item'),
    name: z.string().min(1),
    icon: z.string().optional().describe('Icon id from the icon catalog. Defaults to a generic block.'),
    description: z.string().optional().describe('Plain text.'),
    tile: tile.optional().describe('Omit to place the item on the nearest free tile.'),
    id: z.string().min(1).optional().describe('Omit to derive an id from the name.')
  }),
  z.object({
    op: z.literal('place_item'),
    item: z.string().describe('Id of an item that already exists in the project but not in this view.'),
    tile: tile.optional()
  }),
  z.object({
    op: z.literal('update_item'),
    item: itemRef,
    name: z.string().min(1).optional(),
    icon: z.string().optional(),
    description: z.string().optional().describe('Plain text; an empty string clears it.')
  }),
  z.object({ op: z.literal('move_item'), item: itemRef, tile }),
  z.object({
    op: z.literal('remove_item'),
    item: itemRef,
    everywhere: z.boolean().optional().describe('Remove from every view, not only this one.')
  }),
  z.object({
    op: z.literal('connect'),
    from: itemRef,
    to: itemRef,
    label: z.string().optional(),
    color: color.optional(),
    style: style.optional(),
    width: z.number().positive().optional(),
    via: z.array(tile).optional().describe('Waypoint tiles the connector passes through, in order.')
  }),
  z.object({
    op: z.literal('update_connector'),
    connector: z.string(),
    label: z.string().optional().describe('An empty string clears it.'),
    color: color.optional(),
    style: style.optional(),
    width: z.number().positive().optional()
  }),
  z.object({ op: z.literal('remove_connector'), connector: z.string() }),
  z.object({
    op: z.literal('add_region'),
    items: z.array(itemRef).min(1).optional().describe('Draw the region around these items.'),
    from: tile.optional().describe('Corner tile; use with `to` instead of `items`.'),
    to: tile.optional(),
    label: z.string().optional().describe('Title placed along the region edge.'),
    color: color.optional()
  }),
  z.object({
    op: z.literal('update_region'),
    region: z.string(),
    from: tile.optional(),
    to: tile.optional(),
    color: color.optional(),
    label: z.string().optional().describe('Title along the region edge; an empty string removes it.')
  }),
  z.object({
    op: z.literal('move_region'),
    region: z.string(),
    by: tile.describe('How far to move, in tiles.')
  }).describe('Move a region together with everything standing in it: items, text, waypoints and regions it contains.'),
  z.object({ op: z.literal('remove_region'), region: z.string() }),
  z.object({
    op: z.literal('add_text'),
    content: z.string().min(1),
    tile,
    fontSize: z.number().positive().optional().describe('In tiles; 0.6 when omitted.'),
    orientation: z.enum(['X', 'Y']).optional().describe('Axis the text runs along.')
  }),
  z.object({
    op: z.literal('update_text'),
    text: z.string(),
    content: z.string().min(1).optional(),
    tile: tile.optional(),
    fontSize: z.number().positive().optional(),
    orientation: z.enum(['X', 'Y']).optional()
  }),
  z.object({ op: z.literal('remove_text'), text: z.string() }),
  z.object({ op: z.literal('auto_layout') })
]);

export type Operation = z.infer<typeof operationSchema>;

const specId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Use letters, digits, "-" and "_".');

export const diagramSpecSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: specId,
        name: z.string().min(1),
        icon: z.string().optional().describe('Icon id from the icon catalog. Defaults to a generic block.'),
        description: z.string().optional().describe('Plain text.'),
        group: z
          .string()
          .optional()
          .describe('Id of the group this node sits in. Group membership is set here, not on the group.')
      })
    )
    .min(1),
  edges: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().optional(),
        color: color.optional(),
        style: style.optional()
      })
    )
    .default([]),
  groups: z
    .array(
      z
        .object({ id: specId, name: z.string().min(1), color: color.optional() })
        .describe('A titled region. Assign nodes to it with the node "group" field.')
        // Membership lives on the node ("group": "<id>"). Zod strips unknown keys, so a caller
        // that lists a group's nodes here would otherwise get no region and no complaint.
        .strict()
    )
    .default([])
});

export type DiagramSpec = z.infer<typeof diagramSpecSchema>;
