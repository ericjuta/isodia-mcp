import chroma from 'chroma-js';
import { resolveIcon } from './icons';
import { connectorPath } from './path';
import { estimateTextWidth, textBoxSpan, wrapText } from './text';
import { FONT_FAMILY, INK, INK_SOFT, PALETTE, PAPER } from './theme';
import type { Coords, Model, TextOrientation, View } from './types';

/**
 * Headless SVG rendering of one view. Placement follows the editor's own components: the same
 * tile projection, the same CSS matrices applied to the same origins, and the same draw order
 * (regions, connectors, text, connector labels, then items back to front).
 *
 * The finish does not. The editor is a working surface seen zoomed in; this is the picture that
 * lands in a document, usually scaled down. So labels are set larger, and lines, arrowheads and
 * region titles are inked: whatever colour they carry is taken down to a lightness that reads.
 */

const TILE = 100;
const PROJECTED_WIDTH = TILE * 1.415;
const PROJECTED_HEIGHT = TILE * 0.819;
const HALF_W = PROJECTED_WIDTH / 2;
const HALF_H = PROJECTED_HEIGHT / 2;

/** The editor's isometric CSS matrices, per text orientation. */
const ISO_MATRIX: Record<TextOrientation, readonly number[]> = {
  X: [0.707, -0.409, 0.707, 0.409, 0, -0.816],
  Y: [0.707, 0.409, -0.707, 0.409, 0, -0.816]
};

const FALLBACK_COLOR = PALETTE[0].value;
/** Lightness (CIE L*) that lines and arrowheads are inked to, and the deeper one for titles. */
const LINE_LIGHTNESS = 40;
const TITLE_LIGHTNESS = 27;
const LABEL_FILL = '#ffffff';

interface LabelStyle {
  fontSize: number;
  lineHeight: number;
  padX: number;
  padY: number;
  weight: number;
  fill: string;
  /** Widest a line of text may run before it wraps. */
  wrap: number;
  radius: number;
}

/** An item's name: the thing itself, so the strongest text in the picture. */
const ITEM_LABEL: LabelStyle = { fontSize: 22, lineHeight: 30, padX: 14, padY: 7, weight: 600, fill: INK, wrap: 290, radius: 8 };
/** What a connector carries: quieter, and pill-shaped so it never reads as an item. */
const CONNECTOR_LABEL: LabelStyle = { fontSize: 19, lineHeight: 25, padX: 13, padY: 5, weight: 500, fill: INK_SOFT, wrap: 210, radius: 18 };
/** The editor's fallback when a view item carries no label height. */
const DEFAULT_LABEL_HEIGHT = 20;
const DEFAULT_TEXT_SIZE = 0.6;
const DEFAULT_CONNECTOR_WIDTH = 10;
const REGION_CORNER_RADIUS = 22;

export interface RenderOptions {
  /** Canvas colour; `null` leaves it transparent. Defaults to the paper. */
  background?: string | null;
  /** Pixels of margin around the content. */
  padding?: number;
}

export interface RenderedView {
  svg: string;
  width: number;
  height: number;
}

const px = (value: number): string => String(Math.round(value * 100) / 100);

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Screen position of a tile's centre; the editor's `getTilePosition`. */
const center = (tile: Coords): Coords => ({
  x: HALF_W * (tile.x - tile.y),
  y: -HALF_H * (tile.x + tile.y)
});

const boxHeight = (lines: string[], style: LabelStyle): number => lines.length * style.lineHeight + style.padY * 2;

/**
 * A colour as ink: its hue, at a lightness dark enough for a line or a word. Chroma is raised
 * in proportion, so a pale wash becomes a recognisable deep version of itself and a grey stays
 * grey. A colour already darker than `lightness` is left as it is.
 */
function inked(color: string, lightness: number): string {
  if (!chroma.valid(color)) return escapeXml(color);
  const [l, c, h] = chroma(color).lch();
  return l <= lightness ? chroma(color).hex() : chroma.lch(lightness, Math.min(c * 2.4, 46), h).hex();
}

/** The editor's "dark" colour variant. */
function darker(color: string, grade: number): string {
  return chroma.valid(color) ? chroma(color).darken(grade).saturate(grade).css() : color;
}

/** Direction of a connector's arrowhead; the editor's `getConnectorDirectionIcon`. */
function arrowRotation(from: Coords, to: Coords): number {
  if (to.x > from.x) return to.y > from.y ? 135 : to.y < from.y ? 45 : 90;
  if (to.x < from.x) return to.y > from.y ? -135 : to.y < from.y ? -45 : -90;
  return to.y > from.y ? 180 : to.y < from.y ? 0 : -90;
}

const aspectCache = new Map<string, number>();

/**
 * Height over width of an icon image, which is how a browser sizes an `<img>` given only a
 * width. SVG data URIs are inspected; anything else is taken as square.
 */
function iconAspect(url: string): number {
  const cached = aspectCache.get(url);
  if (cached !== undefined) return cached;

  let source = '';
  const base64 = /^data:image\/svg\+xml;base64,/.exec(url);
  if (base64) {
    // The root tag sits at the start; 4096 base64 characters decode cleanly on their own.
    source = Buffer.from(url.slice(base64[0].length, base64[0].length + 4096), 'base64').toString('utf8');
  } else if (url.startsWith('data:image/svg+xml')) {
    try {
      source = decodeURIComponent(url.slice(url.indexOf(',') + 1));
    } catch {
      source = '';
    }
  }

  let aspect = 1;
  const tag = /<svg\b[^>]*>/i.exec(source)?.[0];
  if (tag) {
    const width = Number(/\swidth="([\d.]+)(?:px)?"/.exec(tag)?.[1]);
    const height = Number(/\sheight="([\d.]+)(?:px)?"/.exec(tag)?.[1]);
    const viewBox = /\sviewBox="([^"]+)"/.exec(tag)?.[1].trim().split(/[\s,]+/).map(Number);
    if (width > 0 && height > 0) aspect = height / width;
    else if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) aspect = viewBox[3] / viewBox[2];
  }
  aspectCache.set(url, aspect);
  return aspect;
}

export function renderViewSvg(model: Model, view: View, options: RenderOptions = {}): RenderedView {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const extend = (x: number, y: number): void => {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  };

  /**
   * Transform for a `width` x `height` box lying on the tile plane with its corner on
   * `originTile`; the editor's `useIsoProjection`.
   */
  const plane = (originTile: Coords, orientation: TextOrientation, width: number, height: number): string => {
    const origin = center(originTile);
    const tx = orientation === 'Y' ? origin.x : origin.x - HALF_W;
    const ty = orientation === 'Y' ? origin.y - HALF_H : origin.y;
    const [a, b, c, d, e, f] = ISO_MATRIX[orientation];
    for (const [x, y] of [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height]
    ]) {
      extend(a * x + c * y + e + tx, b * x + d * y + f + ty);
    }
    return `translate(${px(tx)} ${px(ty)}) matrix(${ISO_MATRIX[orientation].join(' ')})`;
  };

  const paint = (colorId: string | undefined): string =>
    (model.colors.find((color) => color.id === colorId) ?? model.colors[0])?.value ?? FALLBACK_COLOR;

  /** A rounded box of centred text lines whose top edge is at `top`. */
  const labelBox = (lines: string[], style: LabelStyle, centerX: number, top: number): { markup: string; height: number } => {
    // A label that wraps to nothing (empty, or whitespace only) must not draw. Without this,
    // Math.max() over an empty list yields -Infinity, and the resulting rect poisons the whole
    // canvas: the viewBox becomes NaN and nothing renders.
    if (lines.length === 0) return { markup: '', height: 0 };
    const textWidth = Math.max(...lines.map((line) => estimateTextWidth(line, style.fontSize, style.weight >= 600)));
    const width = textWidth + style.padX * 2;
    const height = boxHeight(lines, style);
    const left = centerX - width / 2;
    extend(left, top);
    extend(left + width, top + height);
    const text = lines
      .map((line, index) => {
        const baseline = top + style.padY + style.lineHeight * (index + 0.5) + style.fontSize * 0.35;
        return `<text x="${px(centerX)}" y="${px(baseline)}" text-anchor="middle" font-size="${style.fontSize}" font-weight="${style.weight}" fill="${style.fill}">${escapeXml(line)}</text>`;
      })
      .join('');
    return {
      markup: `<rect x="${px(left)}" y="${px(top)}" width="${px(width)}" height="${px(height)}" rx="${Math.min(style.radius, height / 2)}" fill="${LABEL_FILL}" stroke="${INK}" stroke-opacity="0.22" stroke-width="1.5"/>${text}`,
      height
    };
  };

  const regions = (view.rectangles ?? []).map((rectangle) => {
    const lowX = Math.min(rectangle.from.x, rectangle.to.x);
    const highY = Math.max(rectangle.from.y, rectangle.to.y);
    const width = (Math.abs(rectangle.from.x - rectangle.to.x) + 1) * TILE;
    const height = (Math.abs(rectangle.from.y - rectangle.to.y) + 1) * TILE;
    const color = paint(rectangle.color);
    return `<g transform="${plane({ x: lowX, y: highY }, 'X', width, height)}"><rect width="${width}" height="${height}" rx="${REGION_CORNER_RADIUS}" fill="${escapeXml(color)}" stroke="${darker(color, 0.5)}" stroke-width="2.5"/></g>`;
  });

  const connectors: string[] = [];
  const connectorLabels: string[] = [];
  /** Tiles already carrying a connector label; two labels on one tile hide each other. */
  const labelTiles = new Set<string>();
  for (const connector of view.connectors ?? []) {
    let path;
    try {
      path = connectorPath(connector, view);
    } catch {
      // A connector whose anchors no longer resolve has nothing to draw.
      continue;
    }
    if (path.tiles.length === 0) continue;
    const width = path.size.width * TILE;
    const height = path.size.height * TILE;
    const stroke = connector.width ?? DEFAULT_CONNECTOR_WIDTH;
    const dash =
      connector.style === 'DASHED'
        ? `${stroke * 2} ${stroke * 2}`
        : connector.style === 'DOTTED'
          ? `0 ${px(stroke * 1.8)}`
          : 'none';
    const points = path.tiles.map((tile) => `${tile.x * TILE + TILE / 2},${tile.y * TILE + TILE / 2}`).join(' ');
    const line = `fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${dash}" points="${points}"`;
    const ink = inked(paint(connector.color), LINE_LIGHTNESS);
    let arrow = '';
    if (path.tiles.length >= 2) {
      const at = path.tiles[path.tiles.length - 2];
      const rotation = arrowRotation(at, path.tiles[path.tiles.length - 1]);
      arrow = `<g transform="translate(${at.x * TILE + TILE / 2} ${at.y * TILE + TILE / 2}) rotate(${rotation})"><polygon fill="${ink}" stroke="${PAPER}" stroke-width="4" stroke-linejoin="round" points="17.58,17.01 0,-17.01 -17.58,17.01"/></g>`;
    }
    // The editor draws path tiles mirrored along x and flips the whole layer back; so does this.
    const projection = plane({ x: path.origin.x - path.size.width + 1, y: path.origin.y }, 'X', width, height);
    connectors.push(
      `<g transform="${projection}"><g transform="translate(${width} 0) scale(-1 1)"><polyline stroke="${PAPER}" stroke-opacity="0.85" stroke-width="${px(stroke * 1.6)}" ${line}/><polyline stroke="${ink}" stroke-width="${stroke}" ${line}/>${arrow}</g></g>`
    );

    if (connector.description) {
      // The editor centres the label on the middle path tile. A short path is mostly its own
      // anchors, so that tile often belongs to an item — and items paint last, which puts the
      // label behind the icon. Two connectors can also share a tile, stacking two labels so one
      // hides the other. Prefer a free tile with the most clearance from every item, nearest the
      // middle of the path so the label still reads as belonging to its connector.
      const middle = Math.floor(path.tiles.length / 2);
      const route = path.tiles.map((tile) => ({ x: path.origin.x - tile.x, y: path.origin.y - tile.y }));
      const clearanceAt = (tile: Coords): number =>
        Math.min(
          ...view.items.map((item) =>
            Math.max(Math.abs(item.tile.x - tile.x), Math.abs(item.tile.y - tile.y))
          )
        );
      let chosen = route[middle];
      let best: { clearance: number; taken: number; distance: number } | undefined;
      route.forEach((tile, index) => {
        const candidate = {
          clearance: clearanceAt(tile),
          taken: labelTiles.has(`${tile.x},${tile.y}`) ? 1 : 0,
          distance: Math.abs(index - middle)
        };
        const better =
          best === undefined ||
          candidate.taken < best.taken ||
          (candidate.taken === best.taken &&
            (candidate.clearance > best.clearance ||
              (candidate.clearance === best.clearance && candidate.distance < best.distance)));
        if (better) {
          chosen = tile;
          best = candidate;
        }
      });
      labelTiles.add(`${chosen.x},${chosen.y}`);
      const at = center(chosen);
      const lines = wrapText(connector.description, CONNECTOR_LABEL.wrap, CONNECTOR_LABEL.fontSize);
      connectorLabels.push(
        labelBox(lines, CONNECTOR_LABEL, at.x, at.y - boxHeight(lines, CONNECTOR_LABEL) / 2).markup
      );
    }
  }

  const texts = (view.textBoxes ?? []).map((text) => {
    const size = text.fontSize ?? DEFAULT_TEXT_SIZE;
    const fontSize = size * TILE;
    const width = (textBoxSpan(text.content, size) + 1) * TILE;
    const transform = plane(text.tile, text.orientation ?? 'X', width, TILE);
    const glyphs = `x="20" y="${px(TILE / 2 + fontSize * 0.35)}" font-size="${px(fontSize)}" font-weight="700"`;
    // Text standing in a region is that region's title, and takes its colour, deepened to ink.
    const region = (view.rectangles ?? []).find(
      (rectangle) =>
        text.tile.x >= Math.min(rectangle.from.x, rectangle.to.x) &&
        text.tile.x <= Math.max(rectangle.from.x, rectangle.to.x) &&
        text.tile.y >= Math.min(rectangle.from.y, rectangle.to.y) &&
        text.tile.y <= Math.max(rectangle.from.y, rectangle.to.y)
    );
    const ground = region ? paint(region.color) : PAPER;
    const fill = region ? inked(ground, TITLE_LIGHTNESS) : INK;
    // A halo in the colour of the ground under the glyphs, so a line passing behind a title
    // breaks around the word instead of cutting through it. The editor places titles where
    // lines run, not around them.
    const halo = `stroke="${escapeXml(ground)}" stroke-width="${px(fontSize * 0.26)}" stroke-linejoin="round"`;
    return `<g transform="${transform}"><text ${glyphs} ${halo}>${escapeXml(text.content)}</text><text ${glyphs} fill="${fill}">${escapeXml(text.content)}</text></g>`;
  });

  // Items further back (higher x + y) are drawn first; ties keep the editor's reversed order.
  const backToFront = [...view.items].reverse().sort((a, b) => b.tile.x + b.tile.y - (a.tile.x + a.tile.y));
  const nodes = backToFront.map((viewItem) => {
    const item = model.items.find((candidate) => candidate.id === viewItem.id);
    const at = center(viewItem.tile);
    extend(at.x - HALF_W, at.y - HALF_H);
    extend(at.x + HALF_W, at.y + HALF_H);
    let markup = '';

    if (item?.name) {
      const labelHeight = viewItem.labelHeight ?? DEFAULT_LABEL_HEIGHT;
      const lines = wrapText(item.name, ITEM_LABEL.wrap, ITEM_LABEL.fontSize, true);
      const bottom = at.y - labelHeight;
      if (labelHeight > 0) {
        markup += `<line x1="${px(at.x)}" y1="${px(bottom)}" x2="${px(at.x)}" y2="${px(at.y)}" stroke="${INK}" stroke-opacity="0.45" stroke-width="2"/>`;
      }
      markup += labelBox(lines, ITEM_LABEL, at.x, bottom - boxHeight(lines, ITEM_LABEL)).markup;
    }

    const icon = item?.icon === undefined ? undefined : resolveIcon(model, item.icon);
    if (icon?.url) {
      const aspect = iconAspect(icon.url);
      if (icon.isIsometric) {
        const width = PROJECTED_WIDTH * 0.8;
        const height = width * aspect;
        const left = at.x - width / 2;
        const top = at.y + HALF_H - height;
        extend(left, top);
        extend(left + width, top + height);
        markup += `<image href="${escapeXml(icon.url)}" x="${px(left)}" y="${px(top)}" width="${px(width)}" height="${px(height)}"/>`;
      } else {
        const width = PROJECTED_WIDTH * 0.7;
        const height = width * aspect;
        markup += `<g transform="${plane(viewItem.tile, 'X', width, height)}"><image href="${escapeXml(icon.url)}" width="${px(width)}" height="${px(height)}"/></g>`;
      }
    }
    return markup;
  });

  if (bounds.minX === Infinity) {
    extend(-PROJECTED_WIDTH, -PROJECTED_HEIGHT);
    extend(PROJECTED_WIDTH, PROJECTED_HEIGHT);
  }
  const padding = options.padding ?? 40;
  const x = Math.floor(bounds.minX - padding);
  const y = Math.floor(bounds.minY - padding);
  const width = Math.ceil(bounds.maxX + padding) - x;
  const height = Math.ceil(bounds.maxY + padding) - y;
  const background = options.background === undefined ? PAPER : options.background;
  const backdrop =
    background === null
      ? ''
      : `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${escapeXml(background)}"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}" font-family="${FONT_FAMILY}">${backdrop}${regions.join('')}${connectors.join('')}${texts.join('')}${connectorLabels.join('')}${nodes.join('')}</svg>`;
  return { svg, width, height };
}
