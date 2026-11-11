/**
 * Contact sheet of the bundled icon set: every icon on its tile, at the size it is drawn on the
 * canvas and at the size a reader meets it in an exported picture. Judge new icons here, next
 * to their neighbours, before they ship.
 *
 *   bun scripts/icon-sheet.ts --out sheet.png
 */
import { ICON_CATALOG } from '../src/core/icons';
import { svgToPng } from '../src/core/png';
import { FONT_FAMILY, INK_SOFT, PAPER } from '../src/core/theme';

const out = process.argv[process.argv.indexOf('--out') + 1];
if (!process.argv.includes('--out') || !out) throw new Error('Usage: bun scripts/icon-sheet.ts --out <file.png>');

const COLUMNS = 10;
const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function section(width: number, top: number): { markup: string; height: number } {
  const cell = width * 1.5;
  const rowHeight = width * 1.7 + 22;
  const parts = ICON_CATALOG.map((icon, index) => {
    const x = (index % COLUMNS) * cell + cell / 2;
    const y = top + Math.floor(index / COLUMNS) * rowHeight + width * 1.4;
    const half = width / 2;
    const diamond = `M${x - half} ${y}L${x} ${y - half * 0.579}L${x + half} ${y}L${x} ${y + half * 0.579}Z`;
    const svg = atob(icon.url.slice(icon.url.indexOf(',') + 1));
    const [, , w, h] = /viewBox="([^"]+)"/.exec(svg)![1].split(' ').map(Number);
    const height = (width * h) / w;
    return (
      `<path d="${diamond}" fill="#e9e5da" stroke="#cfcabc"/>` +
      `<image href="${icon.url}" x="${x - half}" y="${y + half * 0.579 - height}" width="${width}" height="${height}"/>` +
      `<text x="${x}" y="${y + half * 0.579 + 18}" text-anchor="middle" font-size="12" fill="${INK_SOFT}">${escape(icon.id)}</text>`
    );
  });
  return { markup: parts.join(''), height: Math.ceil(ICON_CATALOG.length / COLUMNS) * rowHeight + 10 };
}

const large = section(113, 10);
const small = section(48, 10 + large.height);
const width = 113 * 1.5 * COLUMNS;
const height = 10 + large.height + small.height;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT_FAMILY}"><rect width="${width}" height="${height}" fill="${PAPER}"/>${large.markup}${small.markup}</svg>`;
await Bun.write(out, svgToPng(svg, width));
console.log(`${ICON_CATALOG.length} icons -> ${out}`);
