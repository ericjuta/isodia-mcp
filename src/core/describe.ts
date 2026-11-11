import { colorName } from './model';
import { htmlToText } from './text';
import type { AnchorRef, Coords, Model, View } from './types';

/** A view as an agent needs it: ids, names and positions, with no icon payloads. */
export interface ViewDescription {
  project: string;
  view: { id: string; name: string; description?: string };
  views: { id: string; name: string; items: number }[];
  items: { id: string; name: string; icon?: string; tile: Coords; description?: string }[];
  connectors: {
    id: string;
    from: string;
    to: string;
    label?: string;
    style?: string;
    color?: string;
    via?: Coords[];
  }[];
  regions: { id: string; from: Coords; to: Coords; color?: string; contains: string[] }[];
  texts: { id: string; content: string; tile: Coords }[];
}

function endpoint(ref: AnchorRef | undefined): string {
  if (ref?.item !== undefined) return ref.item;
  if (ref?.tile) return `tile(${ref.tile.x},${ref.tile.y})`;
  if (ref?.anchor !== undefined) return `anchor(${ref.anchor})`;
  return 'unknown';
}

export function describeView(model: Model, view: View): ViewDescription {
  return {
    project: model.title,
    view: { id: view.id, name: view.name, description: view.description },
    views: model.views.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      items: candidate.items.length
    })),
    items: view.items.map((viewItem) => {
      const item = model.items.find((candidate) => candidate.id === viewItem.id);
      return {
        id: viewItem.id,
        name: item?.name ?? '',
        icon: item?.icon,
        tile: viewItem.tile,
        description: item?.description ? htmlToText(item.description) : undefined
      };
    }),
    connectors: (view.connectors ?? []).map((connector) => {
      const via = connector.anchors.slice(1, -1).flatMap((anchor) => (anchor.ref.tile ? [anchor.ref.tile] : []));
      return {
        id: connector.id,
        from: endpoint(connector.anchors[0]?.ref),
        to: endpoint(connector.anchors.at(-1)?.ref),
        label: connector.description,
        style: connector.style,
        color: connector.color === undefined ? undefined : colorName(model, connector.color),
        via: via.length > 0 ? via : undefined
      };
    }),
    regions: (view.rectangles ?? []).map((rectangle) => {
      const lowX = Math.min(rectangle.from.x, rectangle.to.x);
      const highX = Math.max(rectangle.from.x, rectangle.to.x);
      const lowY = Math.min(rectangle.from.y, rectangle.to.y);
      const highY = Math.max(rectangle.from.y, rectangle.to.y);
      return {
        id: rectangle.id,
        from: rectangle.from,
        to: rectangle.to,
        color: rectangle.color === undefined ? undefined : colorName(model, rectangle.color),
        contains: view.items
          .filter(({ tile }) => tile.x >= lowX && tile.x <= highX && tile.y >= lowY && tile.y <= highY)
          .map((item) => item.id)
      };
    }),
    texts: (view.textBoxes ?? []).map((text) => ({ id: text.id, content: text.content, tile: text.tile }))
  };
}
