/**
 * Browser smoke test of the web app: dashboard, the editor's tools, agent sync, history, views
 * and share links. It needs a running server (the API alone is enough when it serves the built
 * app; in development, the API on 4400 and Vite on 4401), a seeded demo project
 * (`bun scripts/seed-demo.ts`) and a Chrome or Chromium binary named by CHROME_PATH.
 *
 *   CHROME_PATH=/usr/bin/chromium bun scripts/browser-check.ts
 *
 * Screenshots go to SHOTS (default /tmp/isodia-check). Exits non-zero on the first failure.
 */
import { mkdir } from 'node:fs/promises';
import puppeteer, { type HTTPRequest, type Page } from 'puppeteer-core';
import { tileCenter } from '../src/core/render';
import type { Coords, Model } from '../src/core/types';

const CHROME = process.env.CHROME_PATH;
if (CHROME === undefined) throw new Error('Set CHROME_PATH to a Chrome or Chromium binary.');
const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:4401';
const API = process.env.API_URL ?? 'http://127.0.0.1:4400';
const PROJECT = process.env.PROJECT_ID ?? 'payments-platform';
const SHOTS = process.env.SHOTS ?? '/tmp/isodia-check';
await mkdir(SHOTS, { recursive: true });

const step = (message: string): void => console.log(`\n== ${message}`);
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Project {
  id: string;
  revision: number;
  model: Model;
}
const send = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return (response.status === 204 ? undefined : await response.json()) as T;
};
const project = (id: string): Promise<Project> => send<Project>(`/api/projects/${id}`);

/** Wait until the server holds a project for which `test` passes; the editor saves on its own clock. */
async function saved(id: string, what: string, test: (project: Project) => boolean): Promise<Project> {
  let last: Project | undefined;
  for (let attempt = 0; attempt < 60; attempt++) {
    last = await project(id);
    if (test(last)) return last;
    await pause(150);
  }
  throw new Error(`Not saved: ${what}. The server still holds ${JSON.stringify(last?.model.views[0]).slice(0, 400)}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

const failures: string[] = [];
const watch = (page: Page): void => {
  page.on('pageerror', (error) => failures.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text().slice(0, 300)}`);
  });
  page.on('response', (response) => {
    if (response.status() === 404) failures.push(`404: ${response.url()}`);
  });
};

const open = async (url: string): Promise<Page> => {
  const page = await browser.newPage();
  watch(page);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle2' });
  return page;
};

/** Go ahead with the open dialog, typing `value` first when it asks for text. */
const answerDialog = async (page: Page, value?: string): Promise<void> => {
  await page.waitForSelector('dialog[open] button[type="submit"]', { timeout: 5000 });
  if (value !== undefined) await page.type('dialog[open] input', value);
  await page.click('dialog[open] button[type="submit"]');
};

const clickByText = async (page: Page, selector: string, text: string): Promise<void> => {
  const clicked = await page.evaluate(
    (target, label) => {
      const element = [...document.querySelectorAll(target)].find(
        (node) => node.textContent?.trim() === label && node instanceof HTMLElement
      );
      (element as HTMLElement | undefined)?.click();
      return Boolean(element);
    },
    selector,
    text
  );
  if (!clicked) throw new Error(`No ${selector} with text "${text}"`);
};

/** Pick an entry from the current view's menu. */
const viewAction = async (page: Page, label: string): Promise<void> => {
  await page.click('[aria-label="View actions"]');
  await page.waitForSelector('[role="menu"]', { timeout: 5000 });
  await clickByText(page, '[role="menuitem"]', label);
};

/** Where a tile's centre is on the page, from the pan and zoom the canvas reports. */
const onScreen = async (page: Page, tile: Coords): Promise<Coords> => {
  const stage = await page.$eval('[data-testid="stage"]', (node) => {
    const box = node.getBoundingClientRect();
    const data = (node as SVGSVGElement).dataset;
    return { left: box.left, top: box.top, zoom: Number(data.zoom), panX: Number(data.panX), panY: Number(data.panY) };
  });
  const at = tileCenter(tile);
  return { x: stage.left + stage.panX + at.x * stage.zoom, y: stage.top + stage.panY + at.y * stage.zoom };
};

const clickTile = async (page: Page, tile: Coords): Promise<void> => {
  const at = await onScreen(page, tile);
  await page.mouse.click(at.x, at.y);
};

const dragTiles = async (page: Page, from: Coords, to: Coords): Promise<void> => {
  const start = await onScreen(page, from);
  const end = await onScreen(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let index = 1; index <= 12; index++) {
    await page.mouse.move(start.x + ((end.x - start.x) * index) / 12, start.y + ((end.y - start.y) * index) / 12);
    await pause(20);
  }
  await page.mouse.up();
};

const tool = (page: Page, label: string): Promise<void> => clickByText(page, '.toolbar .btn', label);

/** Replace the text of the inspector field with this label, and leave the field. */
const fill = async (page: Page, label: string, value: string): Promise<void> => {
  const selector = `.inspector [aria-label="${label}"]`;
  await page.waitForSelector(selector, { timeout: 5000 });
  await page.click(selector, { count: 3 });
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
};

const page = await open(WEB);

try {
  step('dashboard lists projects with server-rendered thumbnails');
  await page.waitForSelector('.card strong', { timeout: 20000 });
  console.log('cards:', await page.$$eval('.card strong', (nodes) => nodes.map((node) => node.textContent)));
  await page.waitForSelector('.thumb img', { timeout: 30000 });
  const thumbnail = await page.$eval('.thumb img', (image) => (image as HTMLImageElement).naturalWidth);
  if (thumbnail === 0) throw new Error('A project thumbnail did not load');
  await page.screenshot({ path: `${SHOTS}/dashboard.png` });

  step('the editor draws the project an agent built over MCP');
  await page.click(`.card a[href="/p/${PROJECT}"]`);
  await page.waitForSelector('.canvas [data-item]', { timeout: 30000 });
  const stored = await project(PROJECT);
  const drawn = await page.evaluate(() => ({
    items: document.querySelectorAll('.canvas [data-item]').length,
    connectors: document.querySelectorAll('.canvas [data-connector]').length,
    regions: document.querySelectorAll('.canvas [data-region]').length,
    icons: document.querySelectorAll('.canvas [data-item] image').length,
    tabs: [...document.querySelectorAll('.tab')].map((node) => node.textContent?.trim()),
    saveState: document.querySelector('[data-testid="save-state"]')?.textContent?.trim()
  }));
  console.log(drawn);
  if (drawn.items !== stored.model.views[0].items.length) {
    throw new Error(`The canvas draws ${drawn.items} items; the project has ${stored.model.views[0].items.length}`);
  }
  if (drawn.icons !== drawn.items) throw new Error(`${drawn.items - drawn.icons} items were drawn without an icon`);
  await pause(1500);
  if ((await project(PROJECT)).revision !== stored.revision) throw new Error('Opening a project wrote a revision');
  await page.screenshot({ path: `${SHOTS}/editor.png` });

  step('history panel lists revisions with their sources and checkpoints');
  await clickByText(page, '.bar .seg button', 'History');
  await page.waitForSelector('.list li[data-revision]', { timeout: 20000 });
  console.log(
    'revisions:',
    await page.$$eval('.list li[data-revision]', (nodes) => nodes.map((node) => node.textContent?.replace(/\s+/g, ' ').trim()))
  );
  await page.screenshot({ path: `${SHOTS}/history.png` });
  await clickByText(page, '.bar .seg button', 'History');

  step('a change made elsewhere appears in the open editor, without a spurious save');
  const added = await send<{ revision: number }>(`/api/projects/${PROJECT}/operations`, 'POST', {
    operations: [{ op: 'add_item', name: 'Fraud scoring', icon: 'function-module' }]
  });
  await page.waitForSelector('.canvas [data-item="fraud-scoring"]', { timeout: 30000 });
  await pause(2500);
  const afterRemote = await project(PROJECT);
  console.log('revision before/after remote change:', stored.revision, afterRemote.revision);
  if (afterRemote.revision !== added.revision) throw new Error('Loading the remote change wrote a redundant revision');
  await page.screenshot({ path: `${SHOTS}/editor-synced.png` });

  step('every editing tool works on an empty project, and each edit is saved');
  const scratch = await send<Project>('/api/projects', 'POST', { name: 'Editor check' });
  const editor = await open(`${WEB}/p/${scratch.id}`);
  // One revision poll can be caught in flight and answered later by hand; the rest pass through.
  const heldPoll: { arm: boolean; request: HTTPRequest | null } = { arm: false, request: null };
  await editor.setRequestInterception(true);
  editor.on('request', (request) => {
    const isPoll = request.method() === 'GET' && new URL(request.url()).pathname === `/api/projects/${scratch.id}/revision`;
    if (isPoll && heldPoll.arm) {
      heldPoll.arm = false;
      heldPoll.request = request;
    } else {
      void request.continue();
    }
  });
  try {
    const view = (state: Project) => state.model.views[0];

    // The empty state offers the first item; the picker finds an icon by a word that is not its id.
    await clickByText(editor, '.stage-empty .btn', 'Add the first item');
    await editor.waitForSelector('.picker input', { timeout: 5000 });
    await editor.type('.picker input', 'postgres');
    await editor.waitForSelector('.picker-icon[data-icon="database"]', { timeout: 5000 });
    await editor.keyboard.press('Enter');
    await fill(editor, 'Name', 'Orders DB');
    let state = await saved(scratch.id, 'the first item, named', (now) => now.model.items.some((item) => item.name === 'Orders DB'));
    const db = state.model.items[0];
    if (db.icon !== 'database') throw new Error(`Searching "postgres" picked icon "${db.icon}", not "database"`);
    const dbTile = view(state).items[0].tile;
    console.log('added:', db.id, 'at', JSON.stringify(dbTile));

    await tool(editor, 'Add item');
    await editor.waitForSelector('.picker-icon[data-icon="server"]', { timeout: 5000 });
    await editor.click('.picker-icon[data-icon="server"]');
    await fill(editor, 'Name', 'API');
    state = await saved(scratch.id, 'a second item, named', (now) => now.model.items.some((item) => item.name === 'API'));
    const apiId = state.model.items.find((item) => item.name === 'API')!.id;
    const apiTile = view(state).items.find((item) => item.id === apiId)!.tile;
    if (apiTile.x === dbTile.x && apiTile.y === dbTile.y) throw new Error('The second item landed on the first');

    await tool(editor, 'Connect');
    await clickTile(editor, apiTile);
    await clickTile(editor, dbTile);
    await fill(editor, 'Label', 'SQL');
    state = await saved(scratch.id, 'a labelled connector', (now) => view(now).connectors?.[0]?.description === 'SQL');
    const connector = view(state).connectors![0];
    if (connector.anchors[0].ref.item !== apiId || connector.anchors.at(-1)!.ref.item !== db.id) {
      throw new Error('The connector does not run from the first item clicked to the second');
    }

    step('dragging an item moves its tile; a stale poll answer is not taken for a change made elsewhere');
    heldPoll.arm = true;
    for (let attempt = 0; attempt < 50 && heldPoll.request === null; attempt++) await pause(100);
    if (heldPoll.request === null) throw new Error('The editor never polled for changes made elsewhere');
    const revisionBeforeDrag = state.revision;
    const target = { x: apiTile.x + 2, y: apiTile.y + 3 };
    await dragTiles(editor, apiTile, target);
    state = await saved(scratch.id, 'the dragged position', (now) => {
      const tile = view(now).items.find((item) => item.id === apiId)!.tile;
      return tile.x === target.x && tile.y === target.y;
    });
    console.log('drag:', JSON.stringify(apiTile), '->', JSON.stringify(target), '| revision', revisionBeforeDrag, '->', state.revision);
    await (heldPoll.request as HTTPRequest).respond({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ revision: revisionBeforeDrag })
    });
    await pause(1500);
    const lateNotice = await editor.evaluate(() => document.querySelector('.notice')?.textContent?.trim() ?? null);
    if (lateNotice !== null) throw new Error(`The editor took its own save for a change made elsewhere: "${lateNotice}"`);

    step('an item cannot be dropped on a taken tile');
    await dragTiles(editor, target, dbTile);
    await pause(900);
    state = await project(scratch.id);
    const afterRefusal = view(state).items.find((item) => item.id === apiId)!.tile;
    if (afterRefusal.x === dbTile.x && afterRefusal.y === dbTile.y) throw new Error('Two items now share a tile');

    step('a region is drawn, titled, undone and redone');
    await tool(editor, 'Region');
    const corner = { x: dbTile.x - 1, y: dbTile.y - 1 };
    const opposite = { x: dbTile.x + 1, y: dbTile.y + 2 };
    await dragTiles(editor, corner, opposite);
    await fill(editor, 'Title', 'Data');
    state = await saved(
      scratch.id,
      'a titled region',
      (now) => view(now).rectangles?.length === 1 && view(now).textBoxes?.some((text) => text.content === 'Data') === true
    );
    await editor.screenshot({ path: `${SHOTS}/editor-tools.png` });

    await tool(editor, 'Undo');
    await saved(scratch.id, 'the undo of the title', (now) => (view(now).textBoxes ?? []).length === 0);
    await tool(editor, 'Undo');
    await saved(scratch.id, 'the undo of the region', (now) => (view(now).rectangles ?? []).length === 0);
    await tool(editor, 'Redo');
    await tool(editor, 'Redo');
    await saved(scratch.id, 'the redo', (now) => view(now).textBoxes?.some((text) => text.content === 'Data') === true);

    step('text is placed and edited; the Delete key removes the selection');
    await tool(editor, 'Text');
    await clickTile(editor, { x: dbTile.x + 4, y: dbTile.y + 4 });
    await fill(editor, 'Text', 'Draft');
    state = await saved(scratch.id, 'a text box', (now) => view(now).textBoxes?.some((text) => text.content === 'Draft') === true);
    // The field has been left, so the key goes to the canvas and removes the selected text.
    await editor.keyboard.press('Delete');
    await saved(scratch.id, 'the deletion', (now) => !view(now).textBoxes?.some((text) => text.content === 'Draft'));
  } finally {
    await editor.close();
    await send(`/api/projects/${scratch.id}`, 'DELETE');
  }

  step('a second view shares the model but keeps its own layout');
  const viewTabs = (): Promise<string[]> =>
    page.$$eval('nav.tabs .tab', (nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
  const viewNames = async (): Promise<string[]> => (await project(PROJECT)).model.views.map((view) => view.name);
  const tabsBefore = await viewTabs();

  await page.click('[title="Add a view"]');
  await answerDialog(page, 'Added by the browser check');
  const afterAdd = await saved(PROJECT, 'the added view', (now) => now.model.views.length === tabsBefore.length + 1);
  console.log('views after add:', JSON.stringify(afterAdd.model.views.map((view) => view.name)), '| tabs:', JSON.stringify(await viewTabs()));
  if (!(await viewTabs()).includes('Added by the browser check')) throw new Error('The new view did not appear in the tabs');
  await page.waitForSelector('.stage-empty', { timeout: 5000 });

  // Duplicate the populated view: the copy must carry its items.
  await (await page.$$('nav.tabs .tab'))[0].click();
  await page.waitForSelector('.canvas [data-item]', { timeout: 5000 });
  const itemsInFirstView = await page.$$eval('.canvas [data-item]', (nodes) => nodes.length);
  await viewAction(page, 'Duplicate view');
  await saved(PROJECT, 'the duplicated view', (now) => now.model.views.length === tabsBefore.length + 2);
  await pause(400);
  const copiedItems = await page.$$eval('.canvas [data-item]', (nodes) => nodes.length);
  console.log('views after duplicate:', JSON.stringify(await viewNames()), '| items', itemsInFirstView, '->', copiedItems);
  if (copiedItems !== itemsInFirstView) throw new Error(`The duplicated view has ${copiedItems} items, the original ${itemsInFirstView}`);

  // Delete the copy, leaving the model as it was.
  await viewAction(page, 'Delete view');
  await answerDialog(page);
  await saved(PROJECT, 'the deleted view', (now) => now.model.views.length === tabsBefore.length + 1);
  await page.screenshot({ path: `${SHOTS}/views.png` });

  step('share link opens a live, read-only copy');
  const { token } = await send<{ token: string }>(`/api/projects/${PROJECT}/shares`, 'POST', {});
  const shared = await open(`${WEB}/s/${token}`);
  await shared.waitForSelector('.canvas [data-item]', { timeout: 30000 });
  const sharedPage = await shared.evaluate(() => {
    const icons = [...document.querySelectorAll<SVGImageElement>('.canvas [data-item] image')];
    return {
      status: document.querySelector('.status')?.textContent?.trim(),
      items: document.querySelectorAll('.canvas [data-item]').length,
      icons: icons.length,
      // A share page is the surface an outside reader sees: an icon with no picture is a failure.
      emptyIcons: icons.filter((icon) => !(icon.getAttribute('href') ?? '').startsWith('data:image/') || icon.getBBox().width === 0).length,
      tools: Boolean(document.querySelector('.toolbar')),
      viewControls: Boolean(document.querySelector('[title="Add a view"]'))
    };
  });
  console.log('shared page:', sharedPage);
  if (sharedPage.icons === 0 || sharedPage.emptyIcons > 0) throw new Error('The share page is missing icons');
  if (sharedPage.tools || sharedPage.viewControls) throw new Error('The share page offers editing controls');
  // Read-only still answers "what is this?": clicking an item shows its name and notes.
  const firstItem = (await project(PROJECT)).model.views[0].items[0];
  await clickTile(shared, firstItem.tile);
  await shared.waitForSelector('.inspector h3', { timeout: 5000 });
  console.log('read-only item card:', await shared.$eval('.inspector', (node) => node.textContent?.slice(0, 120)));
  if (await shared.$('.inspector input, .inspector textarea, .inspector button')) throw new Error('The read-only card has controls');
  const beforeShareDrag = await project(PROJECT);
  await dragTiles(shared, firstItem.tile, { x: firstItem.tile.x + 2, y: firstItem.tile.y });
  await pause(1200);
  if ((await project(PROJECT)).revision !== beforeShareDrag.revision) throw new Error('A share page changed the project');
  await shared.screenshot({ path: `${SHOTS}/shared.png` });

  step('a revoked share link stops resolving');
  // The two 404s this causes on the share page are the point of the step, not page errors.
  const expected = failures.length;
  await send(`/api/shares/${token}`, 'DELETE');
  const status = (await fetch(`${API}/api/shared/${token}`)).status;
  if (status !== 404) throw new Error(`Expected 404 for a revoked link, got ${status}`);
  await shared.reload({ waitUntil: 'networkidle2' });
  console.log('revoked page notice:', await shared.$eval('.empty', (node) => node.textContent));
  failures.splice(expected);

  step('connect-agent panel shows ready-to-paste configuration');
  await clickByText(page, '.bar .seg button', 'Agent');
  await page.waitForSelector('.panel pre', { timeout: 20000 });
  console.log('config blocks:', await page.$$eval('.panel pre', (nodes) => nodes.length));
  await page.screenshot({ path: `${SHOTS}/agent.png` });

  if (failures.length > 0) throw new Error(`The pages reported errors: ${JSON.stringify(failures, null, 2)}`);
  console.log('\nAll checks passed.');
} finally {
  await browser.close();
}
