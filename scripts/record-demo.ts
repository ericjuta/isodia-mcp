/**
 * Records the README demo. The agent is a real MCP client talking to `/mcp`: it builds the
 * storefront region by region while the canvas is open, adds a connector, cuts a second view and
 * makes a share link. The person drags an item, searches the icons, switches view and opens the
 * history. The last scene is the read-only shared page.
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
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import puppeteer, { type Page } from 'puppeteer-core';
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
const agent = new Client({ name: 'isodia-demo-agent', version: '0.0.0' });
await agent.connect(new StreamableHTTPClientTransport(new URL(`${URL_BASE}/mcp`)));
/** One MCP tool call; a tool error stops the recording. */
const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
  const result = (await agent.callTool({ name, arguments: args })) as CallToolResult;
  const part = result.content.find((entry) => entry.type === 'text');
  const text = part?.type === 'text' ? part.text : '';
  if (result.isError === true) throw new Error(`${name}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
};

const PROJECT = (await call<{ id: string }>('create_project', { name: 'Storefront' })).id;
const CHECKOUT = ['web', 'cdn', 'waf', 'gateway', 'orders', 'db', 'psp'];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 640 });
  await page.goto(`${URL_BASE}/p/${PROJECT}`, { waitUntil: 'networkidle2' });

  // The recording's own furniture: a caption saying who is acting, and a pointer headless Chrome lacks.
  const furnish = (target: Page): Promise<void> => target.evaluate(() => {
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
  await furnish(page);
  /** Glide the pointer to an element, then click it. */
  const press = async (selector: string, label: string): Promise<void> => {
    const at = await page.evaluate(
      (query, wanted) => {
        for (const node of document.querySelectorAll<HTMLElement>(query)) {
          if (node.textContent?.trim() !== wanted) continue;
          const box = node.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        }
        return null;
      },
      selector,
      label
    );
    if (at === null) throw new Error(`No "${label}" at ${selector}`);
    await page.mouse.move(at.x, at.y, { steps: 14 });
    await pause(250);
    await page.mouse.click(at.x, at.y);
  };
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
  // Chrome cannot take a screenshot while the page navigates.
  let navigating = false;
  const recorder = (async () => {
    while (recording) {
      if (navigating) {
        await pause(40);
        continue;
      }
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
    await call('build_diagram', {
      project: PROJECT,
      groups: STOREFRONT.groups.filter((group) => groups.includes(group.id)),
      nodes,
      edges: STOREFRONT.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    });
    await shown(nodes.length);
    await fit();
    await pause(1500);
  }

  const model = await call<Model>('export_project', { project: PROJECT });
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

  await caption('Person', 'searches the built-in icons');
  await press('.toolbar .btn', 'Add item');
  await page.waitForSelector('input[aria-label="Search icons"]');
  await pause(900);
  await page.type('input[aria-label="Search icons"]', 'data', { delay: 160 });
  await pause(1800);
  await page.keyboard.press('Escape');
  await pause(400);

  await caption('Agent', 'edit_diagram · connects Payment provider to API gateway');
  await call('edit_diagram', { project: PROJECT, operations: [{ op: 'connect', from: 'psp', to: 'gateway', label: 'webhook' }] });
  // The canvas asks for changes every two seconds.
  await pause(4600);

  await caption('Agent', 'manage_views · a second view of the same systems: the checkout path');
  await call('manage_views', { project: PROJECT, action: 'create', name: 'Checkout path' });
  const wanted = new Set(CHECKOUT);
  await call('build_diagram', {
    project: PROJECT,
    view: 'Checkout path',
    nodes: STOREFRONT.nodes.filter((node) => wanted.has(node.id)).map(({ group: _group, ...node }) => node),
    edges: STOREFRONT.edges.filter((edge) => wanted.has(edge.from) && wanted.has(edge.to))
  });
  await page.waitForFunction(
    () => [...document.querySelectorAll('.tabs .tab')].some((tab) => tab.textContent?.trim() === 'Checkout path'),
    { timeout: 15000 }
  );
  await pause(600);
  await caption('Person', 'opens the new view');
  await press('.tabs .tab', 'Checkout path');
  await pause(700);
  await fit();
  await pause(2600);

  await caption('', 'Every step is a revision you can restore');
  await press('.bar .seg button', 'History');
  await pause(3200);

  await caption('Agent', 'share_project · a read-only link to hand out');
  const link = await call<{ token: string }>('share_project', { project: PROJECT, action: 'create', view: 'Overview' });
  await pause(1500);
  navigating = true;
  await pause(400);
  await page.goto(`${URL_BASE}/s/${link.token}`, { waitUntil: 'networkidle2' });
  await furnish(page);
  await caption('', 'The shared page: live, read-only, no sign-in');
  navigating = false;
  await pause(3500);

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
  await agent.close();
}
