/**
 * The drawing kit behind the icon set. Icons are paper models: a few folded solids standing on
 * a tile, lit from the upper left, in three paper tones and one ink. They have no hue, because
 * in a diagram colour means territory and belongs to regions.
 *
 * Solids are described in tile-plane units (x and y across the footprint, z up) and projected
 * exactly as tiles are, so an icon's footprint sits on its diamond. Everything here is plain
 * string building with no platform APIs: the same code draws on the server and in the browser.
 */

export const TOP = '#ffffff';
export const LEFT = '#ece9e0';
export const RIGHT = '#d9d5ca';
export const INK = '#1b1d22';

/** An icon is drawn at 0.8 of a tile, one unit to the pixel, so strokes keep their weight. */
const UNIT = 80;
const HALF_W = (UNIT * 1.415) / 2;
const HALF_H = (UNIT * 0.819) / 2;
const RISE = UNIT * 0.8165;
/** Screen radii of a circle of radius 1 lying on the tile plane. */
const ROUND_X = HALF_W * Math.SQRT2;
const ROUND_Y = HALF_H * Math.SQRT2;
/** Outline and detail weights, in pixels at drawn size. */
const OUTLINE = 2.5;
const DETAIL = 2;
const SOFT = 0.45;

export type Pt = readonly [number, number];
/** A position on a face, from its own two axes. */
export type Face = (u: number, v: number) => Pt;

/** Two decimals, and never "-0": the output must be the same bytes on every machine. */
const n = (value: number): string => String(Math.round(value * 100) / 100 + 0);
const path = (points: readonly Pt[], close: boolean): string =>
  `M${points.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}${close ? 'Z' : ''}`;

/** Where a point of the model lands on screen. The front corner of the footprint is (-0.5, -0.5). */
export const at = (x: number, y: number, z = 0): Pt => [HALF_W * (x - y), -HALF_H * (x + y) - RISE * z];

/** A point on the plane at height `z`, given as right and up on screen rather than x and y. */
export const flat = (right: number, up: number, z = 0): Pt =>
  at((right + up) * Math.SQRT1_2, (up - right) * Math.SQRT1_2, z);

/** Points of a face, from pairs of its coordinates. */
export const on = (face: Face, pairs: readonly (readonly [number, number])[]): Pt[] =>
  pairs.map(([u, v]) => face(u, v));

/** A closed ring of points on a face. */
export const ring = (face: Face, u: number, v: number, ru: number, rv = ru, steps = 28): Pt[] =>
  Array.from({ length: steps }, (_, step) => {
    const angle = (2 * Math.PI * step) / steps;
    return face(u + ru * Math.cos(angle), v + rv * Math.sin(angle));
  });

export interface Box {
  /** Faces toward the lower left: u runs from the front edge back, v up. */
  left: Face;
  /** Faces toward the lower right: u runs from the front edge back, v up. */
  right: Face;
  /** u along x, v along y. */
  top: Face;
}

export interface Tub {
  /** The top disc: right and up on screen, in units of its radius. */
  top: Face;
}

export class Pen {
  private readonly parts: string[] = [];
  private highest = 0;

  private see(points: readonly Pt[]): void {
    for (const [, y] of points) this.highest = Math.min(this.highest, y);
  }

  /** A filled, outlined polygon. */
  shape(points: readonly Pt[], fill: string): this {
    this.see(points);
    this.parts.push(`<path d="${path(points, true)}" fill="${fill}"/>`);
    return this;
  }

  /** An ink line. `soft` is for secondary detail, which should recede. */
  line(points: readonly Pt[], options: { soft?: boolean; width?: number; close?: boolean } = {}): this {
    this.see(points);
    const soft = options.soft ? ` stroke-opacity="${SOFT}"` : '';
    this.parts.push(
      `<path d="${path(points, options.close ?? false)}" stroke-width="${options.width ?? DETAIL}"${soft}/>`
    );
    return this;
  }

  /** A solid ink mark: a slot, a stripe, a glyph. */
  mark(points: readonly Pt[]): this {
    this.see(points);
    this.parts.push(`<path d="${path(points, true)}" fill="${INK}" stroke="none"/>`);
    return this;
  }

  dot(center: Pt, radius = 2.6): this {
    this.see([[center[0], center[1] - radius]]);
    this.parts.push(`<circle cx="${n(center[0])}" cy="${n(center[1])}" r="${n(radius)}" fill="${INK}" stroke="none"/>`);
    return this;
  }

  /** A strip of bent paper seen edge on: an ink line with a paper core. For hooks, rings and handles. */
  band(points: readonly Pt[], width = 7, close = false): this {
    this.see(points.map(([x, y]) => [x, y - width / 2] as const));
    const d = path(points, close);
    this.parts.push(
      `<path d="${d}" stroke-width="${width}"/><path d="${d}" stroke="${TOP}" stroke-width="${n(width - OUTLINE * 2)}"/>`
    );
    return this;
  }

  box(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): Box {
    this.shape([at(x0, y0, z0), at(x0, y1, z0), at(x0, y1, z1), at(x0, y0, z1)], LEFT);
    this.shape([at(x0, y0, z0), at(x1, y0, z0), at(x1, y0, z1), at(x0, y0, z1)], RIGHT);
    this.shape([at(x0, y0, z1), at(x1, y0, z1), at(x1, y1, z1), at(x0, y1, z1)], TOP);
    return {
      left: (u, v) => at(x0, y0 + u * (y1 - y0), z0 + v * (z1 - z0)),
      right: (u, v) => at(x0 + u * (x1 - x0), y0, z0 + v * (z1 - z0)),
      top: (u, v) => at(x0 + u * (x1 - x0), y0 + v * (y1 - y0), z1)
    };
  }

  /** A box given by its size, centred on (cx, cy) and standing on z. */
  block(width: number, depth: number, height: number, z = 0, cx = 0, cy = 0): Box {
    return this.box(cx - width / 2, cy - depth / 2, cx + width / 2, cy + depth / 2, z, z + height);
  }

  /** Any outline on the plane, raised straight up. Only the sides that face the viewer are drawn. */
  prism(outline: readonly (readonly [number, number])[], z0: number, z1: number): this {
    const area = outline.reduce((sum, [x, y], index) => {
      const [nextX, nextY] = outline[(index + 1) % outline.length];
      return sum + x * nextY - nextX * y;
    }, 0);
    const turn = area >= 0 ? 1 : -1;
    const sides = outline
      .map(([ax, ay], index) => {
        const [bx, by] = outline[(index + 1) % outline.length];
        // Outward normal of this side.
        const nx = (by - ay) * turn;
        const ny = -(bx - ax) * turn;
        return { ax, ay, bx, by, nx, ny, depth: ax + ay + bx + by };
      })
      .filter((side) => -side.nx - side.ny > 1e-9)
      .sort((a, b) => b.depth - a.depth);
    for (const side of sides) {
      this.shape(
        [at(side.ax, side.ay, z0), at(side.bx, side.by, z0), at(side.bx, side.by, z1), at(side.ax, side.ay, z1)],
        // A side facing -x lands on the left of the picture (screen x grows with x - y), so it
        // takes the left tone, as a box's x = x0 face does; one facing -y takes the right.
        side.nx <= side.ny ? LEFT : RIGHT
      );
    }
    return this.shape(
      outline.map(([x, y]) => at(x, y, z1)),
      TOP
    );
  }

  /**
   * A round solid: radius `r0` at the bottom and `r1` at the top. Equal radii make a cylinder,
   * a zero top makes a cone. The side is lit as two facets, like rolled paper.
   */
  tub(cx: number, cy: number, r0: number, r1: number, z0: number, z1: number): Tub {
    const [bx, by] = at(cx, cy, z0);
    const [tx, ty] = at(cx, cy, z1);
    const bw = ROUND_X * r0;
    const bh = ROUND_Y * r0;
    const tw = ROUND_X * r1;
    const th = ROUND_Y * r1;
    // Where the shaded facet begins, as a fraction of the half-width, and the rim height there.
    const fold = 0.2;
    const drop = Math.sqrt(1 - fold * fold);
    const rim = (fromX: number, fromY: number): string =>
      r1 > 0 ? `A${n(tw)} ${n(th)} 0 0 1 ${n(fromX)} ${n(fromY)}` : '';
    const side = `M${n(tx - tw)} ${n(ty)}L${n(bx - bw)} ${n(by)}A${n(bw)} ${n(bh)} 0 0 0 ${n(bx + bw)} ${n(by)}L${n(tx + tw)} ${n(ty)}${rim(tx - tw, ty)}Z`;
    const shade = `M${n(tx + fold * tw)} ${n(ty + drop * th)}L${n(bx + fold * bw)} ${n(by + drop * bh)}A${n(bw)} ${n(bh)} 0 0 0 ${n(bx + bw)} ${n(by)}L${n(tx + tw)} ${n(ty)}${rim(tx + fold * tw, ty + drop * th)}Z`;
    this.see([[tx, ty - th]]);
    this.parts.push(
      `<path d="${side}" fill="${LEFT}" stroke="none"/><path d="${shade}" fill="${RIGHT}" stroke="none"/><path d="${side}"/>`
    );
    if (r1 > 0) {
      this.parts.push(`<ellipse cx="${n(tx)}" cy="${n(ty)}" rx="${n(tw)}" ry="${n(th)}" fill="${TOP}"/>`);
    }
    return {
      top: (right, up) => {
        const [x, y] = flat(right * r1, up * r1);
        return [tx + x, ty + y];
      }
    };
  }

  /** The front half of a hoop around a round solid of radius `r` at height `z`. */
  hoop(cx: number, cy: number, r: number, z: number, soft = false): this {
    const [x, y] = at(cx, cy, z);
    const opacity = soft ? ` stroke-opacity="${SOFT}"` : '';
    this.parts.push(
      `<path d="M${n(x - ROUND_X * r)} ${n(y)}A${n(ROUND_X * r)} ${n(ROUND_Y * r)} 0 0 0 ${n(x + ROUND_X * r)} ${n(y)}" stroke-width="${DETAIL}"${opacity}/>`
    );
    return this;
  }

  /** A sphere, with a crescent of shade on the side away from the light. Returns its screen centre and radius. */
  ball(cx: number, cy: number, cz: number, r: number): { center: Pt; radius: number } {
    const [x, y] = at(cx, cy, cz);
    const radius = ROUND_X * r;
    const point = (degrees: number): string => {
      const angle = (degrees * Math.PI) / 180;
      return `${n(x + radius * Math.cos(angle))} ${n(y + radius * Math.sin(angle))}`;
    };
    this.see([[x, y - radius]]);
    this.parts.push(
      `<circle cx="${n(x)}" cy="${n(y)}" r="${n(radius)}" fill="${TOP}" stroke="none"/>` +
        `<path d="M${point(-35)}A${n(radius)} ${n(radius)} 0 0 1 ${point(125)}A${n(radius * 1.45)} ${n(radius * 1.45)} 0 0 0 ${point(-35)}Z" fill="${RIGHT}" stroke="none"/>` +
        `<circle cx="${n(x)}" cy="${n(y)}" r="${n(radius)}"/>`
    );
    return { center: [x, y], radius };
  }

  /**
   * A four-sided pyramid; `inverted` stands it on its point. Its sloping faces catch more light
   * than a wall does, so an upright pyramid's left face takes the top tone.
   */
  pyramid(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, inverted = false): this {
    const base = inverted ? z1 : z0;
    const apex = at((x0 + x1) / 2, (y0 + y1) / 2, inverted ? z0 : z1);
    this.shape([at(x0, y0, base), at(x0, y1, base), apex], inverted ? LEFT : TOP);
    this.shape([at(x0, y0, base), at(x1, y0, base), apex], RIGHT);
    return this;
  }

  /** A roof: a ridge along y over the middle of the footprint, its gable toward the lower right. */
  roof(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): this {
    const middle = (x0 + x1) / 2;
    this.shape([at(x0, y0, z0), at(x0, y1, z0), at(middle, y1, z1), at(middle, y0, z1)], TOP);
    this.shape([at(x0, y0, z0), at(x1, y0, z0), at(middle, y0, z1)], RIGHT);
    return this;
  }

  /** The finished icon. The footprint spans the full width and its front corner is at the bottom. */
  svg(): string {
    const width = HALF_W * 2;
    const top = Math.floor(this.highest - OUTLINE);
    const height = Math.ceil(HALF_H + OUTLINE / 2) - top;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${height}" viewBox="${n(-HALF_W)} ${top} ${n(width)} ${height}">` +
      `<g fill="none" stroke="${INK}" stroke-width="${OUTLINE}" stroke-linejoin="round" stroke-linecap="round">${this.parts.join('')}</g></svg>`
    );
  }
}
