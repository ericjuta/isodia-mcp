import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { findView } from '../src/core/model';
import { svgToPng } from '../src/core/png';
import { renderViewSvg } from '../src/core/render';
import { PAPER } from '../src/core/theme';
import { readWalkthroughFile } from '../src/server/disk';

const WIDTH = 1200;
const HEIGHT = 630;
const PADDING = 32;

try {
  const [publication, outDir, ...extra] = process.argv.slice(2);
  if (!publication?.endsWith('.json') || !outDir || extra.length) {
    throw new Error('Usage: bun scripts/render-walkthrough-cards.ts <publication.json> <outDir>');
  }
  const story = await readWalkthroughFile(dirname(publication), basename(publication, '.json'));
  await mkdir(outDir, { recursive: true });
  for (const step of story.steps) {
    const view = findView(story.model, step.view);
    const { svg, width, height } = renderViewSvg(story.model, view, { background: null });
    // The export has its own intrinsic bounds. Fit it, without stretching or cropping,
    // inside a padded viewport on a fixed-size paper canvas.
    const card = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>
  <svg x="${PADDING}" y="${PADDING}" width="${WIDTH - 2 * PADDING}" height="${HEIGHT - 2 * PADDING}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${svg}</svg>
</svg>`;
    const path = join(outDir, `${step.id}.png`);
    await writeFile(path, await svgToPng(card, WIDTH));
    console.log(`Wrote ${path}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
