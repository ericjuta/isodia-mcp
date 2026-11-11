/**
 * Records the README demo: an agent builds the storefront region by region while the canvas is
 * open, a person drags an item, the agent adds a connector, and the history lists every step.
 *
 *   bun run build && PORT=4410 ISODIA_DB=/tmp/demo.db bun src/server/index.ts &
 *   CHROME_PATH=/path/to/chrome URL=http://127.0.0.1:4410 OUT=/tmp/demo-frames bun scripts/record-demo.ts
 *
 * Writes numbered PNG frames and `frames.txt`, an ffmpeg concat list with each frame's real
 * duration. Turn them into the GIF with:
 *
 *   ffmpeg -f concat -safe 0 -i frames.txt -vf "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=none" docs/sample/demo.gif
 *
 * The caption and the pointer are drawn by this script; everything else is the product.
 */
import { mkdir, rm } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { STOREFRONT } from '../examples/storefront-spec';
import { tileCenter } from '../src/core/render';
import type { Coords, Model } from '../src/core/types';

const CHROME = process.env.CHROME_PATH;
if (CHROME === undefined) throw new Error('Set CHROME_PATH to a Chrome or Chromium binary.');
const URL_BASE = process.env.URL ?? 'http://127.0.0.1:4400';
const OUT = process.env.OUT ?? '/tmp/isodia-demo';

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const send = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
  const response = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok && response.status !== 404) throw new Error(`${method} ${path} ${response.status}: ${text.slice(0, 300)}`);
  return (text === '' ? undefined : JSON.parse(text)) as T;
};

const PROJECT = (await send<{ id: string }>('/api/projects', 'POST', { name: 'Storefront' })).id;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${URL_BASE}/p/${PROJECT}`, { waitUntil: 'networkidle2' });

  // The recording's own furniture: a caption saying who is acting, and a pointer headless Chrome lacks.
  await page.evaluate(() => {
    const caption = document.createElement('div');
    caption.id = 'demo-caption';
    caption.style.cssText =
      'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9999;padding:10px 18px;border-radius:999px;' +
      'background:#1b1d22;color:#f7f5ef;font:600 17px "IBM Plex Sans",sans-serif;box-shadow:0 6px 24px rgba(27,29,34,.25);white-space:nowrap';
    document.body.append(caption);
    const pointer = document.createElement('div');
    pointer.id = 'demo-pointer';
    pointer.style.cssText =
      'position:fixed;z-index:10000;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;display:none;pointer-events:none;' +
      'background:rgba(217,72,15,.35);border:2px solid #d9480f';
    document.body.append(pointer);
    window.addEventListener(
      'mousemove',
      (event) => {
        pointer.style.display = 'block';
        pointer.style.left = `${event.clientX}px`;
        pointer.style.top = `${event.clientY}px`;
      },
      true
    );
  });
  const caption = (who: 'Agent' | 'Person' | '', text: string): Promise<void> =>
    page.evaluate(
      (actor, line) => {
        const node = document.getElementById('demo-caption');
        if (node === null) return;
        const colour = actor === 'Agent' ? '#ff8a4c' : '#8fd0c4';
        node.innerHTML = '';
        if (actor !== '') {
          const tag = document.createElement('span');
          tag.textContent = `${actor}  `;
          tag.style.color = colour;
          node.append(tag);
        }
        node.append(line);
      },
      who,
      text
    );

  // Frames are taken as fast as Chrome returns them, each stamped, so playback keeps real time.
  const frames: { file: string; at: number }[] = [];
  let recording = true;
  const recorder = (async () => {
    while (recording) {
      const file = `${OUT}/f${String(frames.length).padStart(4, '0')}.png`;
      const at = performance.now();
      await page.screenshot({ path: file as `${string}.png` });
      frames.push({ file, at });
      await pause(40);
    }
  })();

  const fit = (): Promise<void> =>
    page.evaluate(() => {
      for (const button of document.querySelectorAll<HTMLButtonElement>('.zoombar .btn')) {
        if (button.textContent?.trim() === 'Fit') button.click();
      }
    });
  const onScreen = async (tile: Coords): Promise<Coords> => {
    const stage = await page.$eval('[data-testid="stage"]', (node) => {
      const box = node.getBoundingClientRect();
      const data = (node as SVGSVGElement).dataset;
      return { left: box.left, top: box.top, zoom: Number(data.zoom), panX: Number(data.panX), panY: Number(data.panY) };
    });
    const at = tileCenter(tile);
    return { x: stage.left + stage.panX + at.x * stage.zoom, y: stage.top + stage.panY + at.y * stage.zoom };
  };
  /** Wait for the canvas to show a revision the server already holds. */
  const shown = async (items: number): Promise<void> => {
    await page.waitForFunction((count) => document.querySelectorAll('.stage-svg image').length >= count, { timeout: 15000 }, items);
  };

  await caption('', 'An empty project, open in the browser');
  await pause(1600);

  const stages = [['clients', 'edge'], ['services'], ['async'], ['data'], ['outside']];
  const groups: string[] = [];
  for (const stage of stages) {
    groups.push(...stage);
    const nodes = STOREFRONT.nodes.filter((node) => node.group !== undefined && groups.includes(node.group));
    const ids = new Set(nodes.map((node) => node.id));
    const names = STOREFRONT.groups.filter((group) => stage.includes(group.id)).map((group) => group.name);
    await caption('Agent', `build_diagram · adds ${names.join(' and ')}`);
    await send(`/api/projects/${PROJECT}/build`, 'POST', {
      groups: STOREFRONT.groups.filter((group) => groups.includes(group.id)),
      nodes,
      edges: STOREFRONT.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    });
    await shown(nodes.length);
    await fit();
    await pause(1500);
  }

  const model = (await send<{ model: Model }>(`/api/projects/${PROJECT}`)).model;
  const view = model.views[0];
  const item = view.items.find((candidate) => candidate.id === 'nightly') ?? view.items[0];
  const taken = new Set(view.items.map((candidate) => `${candidate.tile.x},${candidate.tile.y}`));
  const target = [
    { x: item.tile.x, y: item.tile.y + 4 },
    { x: item.tile.x, y: item.tile.y - 4 },
    { x: item.tile.x + 4, y: item.tile.y },
    { x: item.tile.x - 4, y: item.tile.y }
  ].find((tile) => !taken.has(`${tile.x},${tile.y}`));
  if (target === undefined) throw new Error('No free tile next to the item to drag');

  await caption('Person', 'drags an item; it saves itself');
  const start = await onScreen(item.tile);
  const end = await onScreen(target);
  await page.mouse.move(start.x - 160, start.y - 120);
  for (let index = 1; index <= 14; index++) {
    await page.mouse.move(start.x - 160 + (160 * index) / 14, start.y - 120 + (120 * index) / 14);
    await pause(30);
  }
  await page.mouse.down();
  for (let index = 1; index <= 24; index++) {
    await page.mouse.move(start.x + ((end.x - start.x) * index) / 24, start.y + ((end.y - start.y) * index) / 24);
    await pause(35);
  }
  await page.mouse.up();
  await pause(1800);
  await page.keyboard.press('Escape');
  await pause(500);

  await caption('Agent', 'edit_diagram · connects Payment provider to API gateway');
  await send(`/api/projects/${PROJECT}/operations`, 'POST', {
    operations: [{ op: 'connect', from: 'psp', to: 'gateway', label: 'webhook' }]
  });
  // The canvas asks for changes every two seconds.
  await pause(4600);

  await caption('', 'Every step is a revision you can restore');
  await page.evaluate(() => {
    for (const button of document.querySelectorAll<HTMLButtonElement>('.bar .seg button')) {
      if (button.textContent?.trim() === 'History') button.click();
    }
  });
  await pause(3200);

  recording = false;
  await recorder;

  const lines = frames.flatMap((frame, index) => {
    const next = frames[index + 1];
    const seconds = next === undefined ? 1.5 : (next.at - frame.at) / 1000;
    return [`file '${frame.file}'`, `duration ${seconds.toFixed(3)}`];
  });
  lines.push(`file '${frames[frames.length - 1].file}'`);
  await Bun.write(`${OUT}/frames.txt`, `${lines.join('\n')}\n`);
  console.log(`${frames.length} frames over ${((frames[frames.length - 1].at - frames[0].at) / 1000).toFixed(1)} s in ${OUT}`);
} finally {
  await browser.close();
}
