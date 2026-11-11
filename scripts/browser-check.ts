/**
 * Browser smoke test of the web app: dashboard, editor, agent sync, history, share link.
 * Requires the API (port 4400) and Vite (port 4401) to be running, and a Chrome or Chromium
 * binary named by CHROME_PATH.
 *
 *   CHROME_PATH=/usr/bin/chromium bun scripts/browser-check.ts
 */
import puppeteer, { type HTTPRequest, type Page } from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH;
if (CHROME === undefined) throw new Error('Set CHROME_PATH to a Chrome or Chromium binary.');
const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:4401';
const API = process.env.API_URL ?? 'http://127.0.0.1:4400';
const PROJECT = process.env.PROJECT_ID ?? 'payments-platform';

const step = (message: string): void => console.log(`\n== ${message}`);
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const getJson = async (path: string): Promise<Record<string, unknown>> =>
  (await (await fetch(`${API}${path}`)).json()) as Record<string, unknown>;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

const failures: string[] = [];
const watch = (page: Page): void => {
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text().slice(0, 160)}`);
  });
  page.on('response', (response) => {
    if (response.status() === 404) failures.push(`404: ${response.url()}`);
  });
};

/** Go ahead with the open dialog, typing `value` first when it asks for text. */
const answerDialog = async (page: Page, value?: string): Promise<void> => {
  await page.waitForSelector('dialog[open] button[type="submit"]', { timeout: 5000 });
  if (value !== undefined) await page.type('dialog[open] input', value);
  await page.click('dialog[open] button[type="submit"]');
};

/** Pick an entry from the current view's menu. */
const viewAction = async (page: Page, label: string): Promise<void> => {
  await page.click('[aria-label="View actions"]');
  await page.waitForSelector('[role="menu"]', { timeout: 5000 });
  await clickByText(page, '[role="menuitem"]', label);
};

const clickByText = async (page: Page, selector: string, text: string): Promise<void> => {
  const clicked = await page.evaluate(
    (target, label) => {
      const element = [...document.querySelectorAll(target)].find(
        (node) => node.textContent?.trim() === label && node instanceof HTMLElement
      );
      element?.click();
      return Boolean(element);
    },
    selector,
    text
  );
  if (!clicked) throw new Error(`No ${selector} with text "${text}"`);
};

const page = await browser.newPage();
watch(page);
await page.setViewport({ width: 1440, height: 900 });

try {
  step('dashboard lists projects with server-rendered thumbnails');
  await page.goto(WEB, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.card strong', { timeout: 20000 });
  console.log('cards:', await page.$$eval('.card strong', (nodes) => nodes.map((node) => node.textContent)));
  await page.waitForSelector('.thumb img', { timeout: 30000 });
  console.log(
    'thumbnail:',
    await page.$eval('.thumb img', (image) => ({
      naturalWidth: (image as HTMLImageElement).naturalWidth,
      naturalHeight: (image as HTMLImageElement).naturalHeight
    }))
  );
  await page.screenshot({ path: '/tmp/rea-dashboard.png' });

  step('editor loads the model an agent built over MCP');
  await page.click('.card a');
  await page.waitForSelector('.canvas img', { timeout: 30000 });
  await pause(2500);
  console.log(
    await page.evaluate(() => ({
      itemImages: document.querySelectorAll('.canvas img').length,
      svgs: document.querySelectorAll('.canvas svg').length,
      tabs: [...document.querySelectorAll('.tab')].map((node) => node.textContent?.trim()),
      saveState: document.querySelector('[data-testid="save-state"]')?.textContent?.trim(),
      labels: document.body.innerText.split('\n').filter((line) => line.trim() !== '').slice(12, 30)
    }))
  );
  await page.screenshot({ path: '/tmp/rea-editor.png' });

  step('history panel lists revisions with their sources and checkpoints');
  await clickByText(page, '.seg button', 'History');
  await page.waitForSelector('.list li[data-revision]', { timeout: 20000 });
  console.log(
    'revisions:',
    await page.$$eval('.list li[data-revision]', (nodes) =>
      nodes.map((node) => node.textContent?.replace(/\s+/g, ' ').trim())
    )
  );
  await page.screenshot({ path: '/tmp/rea-history.png' });
  await clickByText(page, '.seg button', 'History');

  step('a change made elsewhere appears in the open editor, without a spurious save');
  const before = await getJson(`/api/projects/${PROJECT}`);
  const added = await (
    await fetch(`${API}/api/projects/${PROJECT}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [{ op: 'add_item', name: 'Fraud scoring', icon: 'function-module' }] })
    })
  ).json();
  console.log('agent change:', added);
  await page.waitForFunction(() => document.body.innerText.includes('Fraud scoring'), { timeout: 30000 });
  await pause(2500);
  const afterRemote = await getJson(`/api/projects/${PROJECT}`);
  console.log('revision before/after remote change:', before.revision, afterRemote.revision);
  console.log('save state after remote change:', await page.$eval('[data-testid="save-state"]', (node) => node.textContent));
  if (afterRemote.revision !== (added as { revision: number }).revision) {
    throw new Error('Loading the remote change wrote a redundant revision');
  }
  await page.screenshot({ path: '/tmp/rea-editor-synced.png' });

  step('a change in the editor is autosaved');
  await page.click('[aria-label="Text"]');
  await pause(500);
  const canvasBox = await (await page.$('.canvas'))!.boundingBox();
  await page.mouse.click(canvasBox!.x + 260, canvasBox!.y + canvasBox!.height - 200);
  await pause(3000);
  const afterEdit = await getJson(`/api/projects/${PROJECT}`);
  console.log(
    'revision after editor change:',
    afterEdit.revision,
    '| state:',
    await page.$eval('[data-testid="save-state"]', (node) => node.textContent)
  );
  if ((afterEdit.revision as number) <= (afterRemote.revision as number)) {
    throw new Error('The editor change was not saved');
  }

  step('dragging a node moves its tile and the move is saved');
  // Dragging is hit-tested against tiles, and the icon (pointer-events:none) plus connectors can
  // intercept a press, so use a throwaway project with one node and nothing else on the canvas.
  // That keeps the press target unambiguous and independent of what earlier steps changed.
  const dragProject = (await (
    await fetch(`${API}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Drag check',
        model: {
          version: '1',
          title: 'Drag check',
          items: [{ id: 'solo', name: 'Solo', icon: 'cloud' }],
          views: [{ id: 'main', name: 'Overview', items: [{ id: 'solo', tile: { x: 0, y: 0 } }] }],
          icons: [],
          colors: [{ id: 'color1', value: '#a5b8f3' }]
        }
      })
    })
  ).json()) as { id: string };

  const dragPage = await browser.newPage();
  watch(dragPage);
  await dragPage.setViewport({ width: 1440, height: 900 });
  // One revision poll can be caught in flight and answered later by hand; the rest pass through.
  const heldPoll: { arm: boolean; request: HTTPRequest | null } = { arm: false, request: null };
  await dragPage.setRequestInterception(true);
  dragPage.on('request', (request) => {
    const isPoll =
      request.method() === 'GET' && new URL(request.url()).pathname === `/api/projects/${dragProject.id}/revision`;
    if (isPoll && heldPoll.arm) {
      heldPoll.arm = false;
      heldPoll.request = request;
    } else {
      void request.continue();
    }
  });
  await dragPage.goto(`${WEB}/p/${dragProject.id}`, { waitUntil: 'networkidle2' });
  await dragPage.waitForSelector('.canvas svg', { timeout: 30000 });
  await pause(2500);

  const soloIcon = await dragPage.evaluate(() => {
    const image = document.querySelector('.canvas img') as HTMLImageElement | null;
    if (!image) return null;
    const box = image.getBoundingClientRect();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  });
  if (!soloIcon) throw new Error('The editor rendered no node icon to drag');

  const soloTile = async (): Promise<string> => {
    const project = (await getJson(`/api/projects/${dragProject.id}`)) as unknown as {
      model: { views: Array<{ items: Array<{ id: string; tile: unknown }> }> };
    };
    return JSON.stringify(project.model.views[0].items[0].tile);
  };

  const tileBefore = await soloTile();
  const revisionBeforeDrag = (await getJson(`/api/projects/${dragProject.id}`)).revision as number;
  // Catch a poll in flight, so that its answer predates the save the drag is about to cause.
  heldPoll.arm = true;
  for (let attempt = 0; attempt < 50 && heldPoll.request === null; attempt++) await pause(100);
  if (heldPoll.request === null) throw new Error('The editor never polled for changes made elsewhere');
  const start = { x: soloIcon.x, y: soloIcon.y + 40 };
  await dragPage.mouse.move(start.x, start.y);
  await dragPage.mouse.down();
  await dragPage.mouse.move(start.x + 4, start.y - 2);
  await pause(150);
  for (let stepIndex = 1; stepIndex <= 20; stepIndex++) {
    await dragPage.mouse.move(start.x + 4 + stepIndex * 12, start.y - 2 - stepIndex * 7);
    await pause(45);
  }
  await dragPage.mouse.up();
  await pause(4000);

  const tileAfter = await soloTile();
  const revisionAfterDrag = (await getJson(`/api/projects/${dragProject.id}`)).revision as number;
  console.log(
    'drag tile:',
    tileBefore,
    '->',
    tileAfter,
    '| revision',
    revisionBeforeDrag,
    '->',
    revisionAfterDrag,
    '| state:',
    await dragPage.$eval('[data-testid="save-state"]', (node) => node.textContent)
  );
  await dragPage.screenshot({ path: '/tmp/rea-dragged.png' });
  try {
    if (tileAfter === tileBefore) throw new Error('Dragging a node did not move its tile');
    if (revisionAfterDrag <= revisionBeforeDrag) throw new Error('The dragged position was not saved');

    step('a poll answered before a save, but delivered after it, is not taken for a change made elsewhere');
    await heldPoll.request.respond({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ revision: revisionBeforeDrag })
    });
    await pause(1500);
    const lateNotice = await dragPage.evaluate(() => document.querySelector('.notice')?.textContent?.trim() ?? null);
    console.log('notice after the late answer:', lateNotice);
    if (lateNotice !== null) throw new Error(`The editor took its own save for a change made elsewhere: "${lateNotice}"`);
  } finally {
    await dragPage.close();
    await fetch(`${API}/api/projects/${dragProject.id}`, { method: 'DELETE' });
  }

  step('a second view shares the model but keeps its own layout');
  const viewTabs = (): Promise<string[]> =>
    page.$$eval('nav.tabs .tab', (nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
  const viewNames = async (): Promise<string[]> => {
    const project = (await getJson(`/api/projects/${PROJECT}`)) as unknown as {
      model: { views: Array<{ name: string; items: unknown[] }> };
    };
    return project.model.views.map((view) => view.name);
  };
  const tabsBefore = await viewTabs();

  // Leave the text box the previous step created selected and the editor tears down when the view
  // changes, so dismiss it first; this is the regression the view key in Diagram.tsx guards too.
  await page.keyboard.press('Escape');
  await pause(1000);

  // "+" adds an empty view over the same project items.
  await page.click('[title="Add a view"]');
  await answerDialog(page, 'Added by the browser check');
  await pause(3000);
  const viewsAfterAdd = await viewNames();
  const tabsAfterAdd = await viewTabs();
  console.log('views after add:', JSON.stringify(viewsAfterAdd), '| tabs:', JSON.stringify(tabsAfterAdd));
  if (viewsAfterAdd.length !== tabsBefore.length + 1) {
    throw new Error(`Adding a view did not add exactly one: ${JSON.stringify(viewsAfterAdd)}`);
  }
  const addedView = viewsAfterAdd.find((name) => !tabsBefore.includes(name));
  if (!addedView) throw new Error('The new view did not appear in the editor tabs');

  // Duplicate the populated view: the copy must carry its items.
  const tabNodes = await page.$$('nav.tabs .tab');
  await tabNodes[0].click();
  await pause(1200);
  const itemsInFirstView = (await page.$$eval('.canvas img', (nodes) => nodes.length)) as number;
  await viewAction(page, 'Duplicate view');
  await pause(3000);
  const viewsAfterDuplicate = await viewNames();
  console.log('views after duplicate:', JSON.stringify(viewsAfterDuplicate), '| first view icons:', itemsInFirstView);
  if (viewsAfterDuplicate.length !== viewsAfterAdd.length + 1) {
    throw new Error('Duplicating a view did not add a copy');
  }
  const copiedIcons = await page.$$eval('.canvas img', (nodes) => nodes.length);
  if (copiedIcons !== itemsInFirstView) {
    throw new Error(`The duplicated view has ${copiedIcons} icons, the original ${itemsInFirstView}`);
  }

  // Delete the copy, leaving the model as it was.
  const revisionBeforeDelete = (await getJson(`/api/projects/${PROJECT}`)).revision as number;
  await viewAction(page, 'Delete view');
  await answerDialog(page);
  await pause(3000);
  const viewsAfterDelete = await viewNames();
  const revisionAfterDelete = (await getJson(`/api/projects/${PROJECT}`)).revision as number;
  console.log(
    'views after delete:',
    JSON.stringify(viewsAfterDelete),
    '| revision',
    revisionBeforeDelete,
    '->',
    revisionAfterDelete
  );
  if (viewsAfterDelete.length !== viewsAfterDuplicate.length - 1) {
    throw new Error('Deleting a view did not remove it');
  }
  if (revisionAfterDelete <= revisionBeforeDelete) throw new Error('The view change was not saved');
  await page.screenshot({ path: '/tmp/rea-views.png' });

  step('share link opens a live, read-only copy');
  const created = (await (
    await fetch(`${API}/api/projects/${PROJECT}/shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    })
  ).json()) as { token: string };
  const token = created.token;
  const shared = await browser.newPage();
  watch(shared);
  await shared.setViewport({ width: 1440, height: 900 });
  await shared.goto(`${WEB}/s/${token}`, { waitUntil: 'networkidle2' });
  await shared.waitForSelector('.canvas svg', { timeout: 30000 });
  await pause(2000);
  console.log(
    'shared page:',
    await shared.evaluate(() => ({
      status: document.querySelector('.status')?.textContent?.trim(),
      svgs: document.querySelectorAll('.canvas svg').length,
      imgs: document.querySelectorAll('.canvas img').length,
      brokenImgs: [...document.querySelectorAll('.canvas img')].filter(
        (img) => !(img as HTMLImageElement).complete || (img as HTMLImageElement).naturalWidth === 0
      ).length,
      editable: Boolean(document.querySelector('[title="Add a view"]')),
      text: document.body.innerText.slice(0, 100)
    }))
  );
  // A share page is the surface an outside client sees, so a missing icon or a broken image is a
  // failure, not a cosmetic detail. Counting SVGs alone would not notice either.
  const sharedIcons = await shared.$$eval('.canvas img', (nodes) => nodes.length);
  if (sharedIcons === 0) throw new Error('The share page rendered no icons.');
  const brokenShared = await shared.$$eval(
    '.canvas img',
    (nodes) => nodes.filter((img) => !(img as HTMLImageElement).complete || (img as HTMLImageElement).naturalWidth === 0).length
  );
  if (brokenShared > 0) throw new Error(`${brokenShared} share-page icons failed to load.`);
  await shared.screenshot({ path: '/tmp/rea-shared.png' });

  step('a revoked share link stops resolving');
  await fetch(`${API}/api/shares/${token}`, { method: 'DELETE' });
  const status = (await fetch(`${API}/api/shared/${token}`)).status;
  console.log('shared API status after revoke:', status);
  if (status !== 404) throw new Error(`Expected 404 for a revoked link, got ${status}`);
  await shared.reload({ waitUntil: 'networkidle2' });
  console.log('revoked page notice:', (await shared.$eval('.empty', (node) => node.textContent)) ?? '');

  step('connect-agent panel shows ready-to-paste configuration');
  await clickByText(page, '.seg button', 'Agent');
  await page.waitForSelector('.panel pre', { timeout: 20000 });
  console.log('config blocks:', await page.$$eval('.panel pre', (nodes) => nodes.map((node) => node.textContent)));
  await page.screenshot({ path: '/tmp/rea-agent.png' });
} finally {
  console.log('\npage errors:', failures.length === 0 ? 'none' : failures);
  await browser.close();
}
