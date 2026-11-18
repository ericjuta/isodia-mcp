/**
 * Records the README demo with real MCP calls and browser interactions.
 * Start the API and editor with a fresh scratch database and set ISODIA_WALKTHROUGHS_DIR
 * on the API server to a fresh scratch directory. Use that same directory here:
 *
 *   CHROME_PATH=/path/to/chrome URL=http://localhost:4401 OUT=/tmp/demo-frames \
 *     ISODIA_WALKTHROUGHS_DIR=/tmp/demo-publications bun scripts/record-demo.ts
 *
 * Writes numbered PNG frames and `frames.txt`, an ffmpeg concat list with each frame's real
 * duration. Turn them into the GIF with:
 *
 *   ffmpeg -f concat -i /tmp/demo-frames/frames.txt -vf "fps=8,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" docs/sample/demo.gif
 *
 * The caption and the pointer are drawn by this script; everything else is the product.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
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
const OUT = process.env.OUT;
const PUBLICATIONS = process.env.ISODIA_WALKTHROUGHS_DIR;
if (!OUT || !PUBLICATIONS) throw new Error('Set OUT to a new directory and ISODIA_WALKTHROUGHS_DIR to a scratch publication directory.');
await mkdir(OUT);
await mkdir(PUBLICATIONS, { recursive: true });

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
    await page.mouse.move(at.x, at.y, { steps: 5 });
    await pause(250);
    await page.mouse.click(at.x, at.y);
  };
  const caption = (who: 'Agent' | 'Person' | 'Reader' | 'Author' | '', text: string): Promise<void> =>
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
  // Surface capture errors at the join, not as an unhandled rejection mid-scene.
  void recorder.catch(() => {});

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
  /** What the person does to read the labels: Ctrl-wheel in on a group of tiles, then pan them to the middle. */
  const frame = async (tiles: Coords[], most: number): Promise<void> => {
    await fit();
    await pause(400);
    const points = await Promise.all(tiles.map(onScreen));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const middle = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    const stage = await page.$eval('[data-testid="stage"]', (node) => {
      const box = node.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height, zoom: Number((node as SVGSVGElement).dataset.zoom) };
    });
    const room = Math.min((stage.width * 0.55) / Math.max(Math.max(...xs) - Math.min(...xs), 1), (stage.height * 0.4) / Math.max(Math.max(...ys) - Math.min(...ys), 1));
    const wanted = Math.min(most, stage.zoom * Math.max(room, 1));
    await page.mouse.move(middle.x, middle.y, { steps: 5 });
    await page.keyboard.down('Control');
    // Few, large steps: every frame of camera motion repaints the whole picture, which is what makes a GIF heavy.
    for (let step = 0; step < 20; step++) {
      const zoom = await page.$eval('[data-testid="stage"]', (node) => Number((node as SVGSVGElement).dataset.zoom));
      if (zoom >= wanted) break;
      await page.mouse.wheel({ deltaY: -Math.min(300, Math.log(wanted / zoom) / 0.0022) });
      await pause(160);
    }
    await page.keyboard.up('Control');
    await page.mouse.wheel({ deltaX: middle.x - stage.x, deltaY: middle.y - stage.y });
    await pause(500);
  };
  /** The person clears the "changed elsewhere" notice once they have seen it. */
  const dismiss = async (): Promise<void> => {
    if ((await page.$('.notice .btn')) === null) return;
    await press('.notice .btn', 'Dismiss');
    await pause(300);
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

  await caption('Person', 'dismisses the notice and zooms in');
  await dismiss();
  await frame([item.tile, target], 0.5);
  await pause(900);

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

  const tileOf = (id: string): Coords => {
    const found = view.items.find((candidate) => candidate.id === id);
    if (found === undefined) throw new Error(`No ${id} in the overview`);
    return found.tile;
  };
  await frame([tileOf('gateway'), tileOf('orders')], 0.5);
  await caption('Agent', 'edit_diagram · connects Payment provider to API gateway');
  await call('edit_diagram', { project: PROJECT, operations: [{ op: 'connect', from: 'psp', to: 'gateway', label: 'webhook' }] });
  // The canvas asks for changes every two seconds.
  await pause(4000);
  await dismiss();
  await pause(600);

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
  await dismiss();
  await fit();
  await pause(1400);
  const finalModel = await call<Model>('export_project', { project: PROJECT });
  const checkout = finalModel.views.find((candidate) => candidate.name === 'Checkout path');
  if (checkout === undefined) throw new Error('No Checkout path view');
  await caption('Person', 'zooms in to read it');
  await frame(checkout.items.filter((candidate) => ['gateway', 'orders', 'psp'].includes(candidate.id)).map((candidate) => candidate.tile), 0.55);
  await pause(2200);

  await caption('', 'Every step is a revision you can restore');
  await press('.bar .seg button', 'History');
  await pause(3200);

  await caption('Person', 'exports the checkout view as a PNG');
  await press('.bar .seg button', 'Export');
  await page.waitForFunction(() => document.body.innerText.includes('Download PNG of this view'));
  await pause(1000);
  const png = page.waitForResponse((response) => response.ok() && response.headers()['content-type']?.startsWith('image/png'), { timeout: 8000 });
  await press('.panel-body button', 'Download PNG of this view');
  assert.equal((await (await png).buffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  await pause(1800);

  const open = async (path: string, who: 'Reader' | 'Author', text: string) => {
    navigating = true;
    await pause(450);
    await page.goto(`${URL_BASE}${path}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-testid="stage"]');
    await furnish(page);
    await caption(who, text);
    navigating = false;
  };
  const component = async (id: string) => {
    const handle = await page.waitForSelector(`[data-item="${id}"]`);
    assert.ok(handle);
    const at = await handle.clickablePoint();
    await page.mouse.move(at.x, at.y, { steps: 6 });
    await page.mouse.click(at.x, at.y);
    await handle.dispose();
  };

  await caption('Agent', 'share_project · creates a live, read-only link');
  const link = await call<{ token: string }>('share_project', { project: PROJECT, action: 'create', view: checkout.id });
  await pause(1800);
  await open(`/s/${link.token}`, 'Reader', 'opens the live diagram without signing in');
  await pause(1800);
  await frame(checkout.items.filter(({ id }) => ['orders', 'psp'].includes(id)).map(({ tile }) => tile), 0.55);
  await caption('Reader', 'clicks Orders to read its notes');
  await component('orders');
  await page.waitForFunction(() => document.body.innerText.includes('Checkout and order state'));
  await pause(2800);

  await caption('Author', 'publishes a versioned walkthrough from the same model');
  await Bun.write(join(OUT, 'model.json'), JSON.stringify(finalModel));
  await Bun.write(join(OUT, 'walkthrough.json'), JSON.stringify({
    schemaVersion: 1,
    title: 'How storefront checkout works',
    articleUrl: 'https://example.com/articles/storefront-checkout',
    views: [checkout.id],
    steps: [
      { id: 'enter-checkout', title: 'Enter checkout', body: 'The API gateway routes checkout requests to Orders.', view: checkout.id, component: 'gateway' },
      { id: 'take-payment', title: 'Take payment', body: 'Orders asks the payment provider to charge the customer and records order state in Postgres.', view: checkout.id, component: 'orders' }
    ]
  }));
  const publication = 'storefront-checkout-v1';
  const prepare = Bun.spawn([process.execPath, join(import.meta.dir, 'prepare-walkthrough.ts'), join(OUT, 'model.json'),
    join(OUT, 'walkthrough.json'), join(PUBLICATIONS, `${publication}.json`)], { stdout: 'inherit', stderr: 'inherit' });
  assert.equal(await prepare.exited, 0);
  await pause(1600);

  await open(`/w/${publication}?step=take-payment`, 'Reader', 'opens a link directly to step 2');
  await page.waitForSelector('[data-step="take-payment"][aria-current="step"]');
  await pause(3000);
  await caption('Reader', 'explores another component without leaving the step');
  await component('psp');
  const notes = '[data-testid="component-notes"]';
  await page.waitForFunction((selector) => document.querySelector(selector)?.textContent?.includes('Cards and wallets'), {}, notes);
  await pause(2500);
  await caption('Reader', 'returns to the guided focus');
  await press('[data-testid="return-to-step"]', 'Return to step');
  await page.waitForFunction((selector) => document.querySelector(selector)?.textContent?.includes('Checkout and order state'), {}, notes);
  await pause(2600);
  await caption('Reader', 'switches steps to follow the request from the start');
  await press('[data-step="enter-checkout"]', '1. Enter checkout');
  await page.waitForSelector('[data-step="enter-checkout"][aria-current="step"]');
  await pause(3000);

  recording = false;
  await recorder;

  const lines = frames.flatMap((frame, index) => {
    const next = frames[index + 1];
    const seconds = next === undefined ? 1.5 : (next.at - frame.at) / 1000;
    return [`file '${basename(frame.file)}'`, `duration ${seconds.toFixed(3)}`];
  });
  lines.push(`file '${basename(frames[frames.length - 1].file)}'`);
  await Bun.write(`${OUT}/frames.txt`, `${lines.join('\n')}\n`);
  console.log(`${frames.length} frames over ${((frames[frames.length - 1].at - frames[0].at) / 1000).toFixed(1)} s in ${OUT}`);
} finally {
  await browser.close();
  await agent.close();
}
