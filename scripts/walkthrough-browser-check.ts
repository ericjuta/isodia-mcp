/** CI builds dist first. Run with CHROME_PATH set to a Chromium or Chrome executable. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type axeCore from 'axe-core';
import puppeteer from 'puppeteer-core';
import { svgToPng } from '../src/core/png';
import { prepareWalkthrough } from '../src/core/walkthrough';
import { createApp } from '../src/server/api';
import { diskWalkthroughs, serveWebApp } from '../src/server/disk';
import { openSqlite } from '../src/server/sqlite';
import { Store } from '../src/server/store';
import model from '../docs/sample/walkthrough/checkout.isoflow.json';
import manifest from '../docs/sample/walkthrough/checkout.walkthrough.json';

const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('Set CHROME_PATH to the Chromium executable.');
const root = await mkdtemp(join(tmpdir(), 'isodia-walkthrough-browser-'));
const store = new Store(openSqlite(':memory:'));
const path = '/w/checkout-architecture-v1';
const step = `${path}?step=charge-once`;
const embed = `${path}/embed?step=charge-once`;
const webRoot = join(import.meta.dir, '../dist');
const app = createApp(store, {
  publicUrl: 'http://127.0.0.1', token: 'scratch-browser-test', rasterize: svgToPng,
  walkthroughs: diskWalkthroughs(root, webRoot)
});
serveWebApp(app, webRoot);
const reader = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
const readerOrigin = reader.url.origin;
const article = (framePath: string) => Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(
  `<meta name="viewport" content="width=device-width, initial-scale=1"><iframe title="Checkout walkthrough" src="${readerOrigin}${framePath}" width="100%" height="560" style="border:0"></iframe>`,
  { headers: { 'content-type': 'text/html' } }
) });
const approved = article(embed);
const other = article(embed);
const articleUrl = `${approved.url.origin}/checkout#architecture`;
const focus = (id: string) => `[data-focus="${id}"]`;
const stage = '[data-testid="stage"]';
const notes = '[data-testid="component-notes"]';
const picker = 'select[aria-label="Component"]';
const skip = 'a.walkthrough-skip';
const previous = '.walkthrough-adjacent a[rel="prev"]';
const next = '.walkthrough-adjacent a[rel="next"]';

try {
  await writeFile(join(root, 'checkout-architecture-v1.json'), JSON.stringify(prepareWalkthrough(model, { ...manifest, articleUrl })));
  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(6000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.setViewport({ width: 1040, height: 760 });
    assert.equal((await page.goto(`${readerOrigin}${step}`))?.status(), 200);
    await page.waitForSelector(focus('payments'));
    await page.keyboard.press('Tab');
    assert.ok(await page.$eval(skip, (link) => document.activeElement === link && link.textContent === 'Skip to step'),
      'Skip to step is the first Tab stop');
    assert.ok(await page.$eval(skip, (link) => {
      const style = getComputedStyle(link);
      return style.clipPath === 'none' && style.outlineStyle !== 'none';
    }), 'the focused skip link is visible and outlined');
    const heading = await page.$eval(skip, (link) => link.getAttribute('href'));
    assert.ok(heading?.startsWith('#'));
    await page.keyboard.press('Enter');
    assert.ok(await page.$eval(`h2${heading}`, (element) => document.activeElement === element), 'Skip to step focuses the step heading');
    assert.equal(page.url(), `${readerOrigin}${step}`, 'the skip link preserves the step URL');
    assert.equal(await page.$eval(`h2${heading}`, (element) =>
      document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent), 'Step 2 of 3');

    await page.evaluate(await readFile(require.resolve('axe-core/axe.min.js'), 'utf8'));
    const violations = await page.evaluate(async () => {
      const { axe } = window as Window & { axe?: typeof axeCore };
      if (!axe) throw new Error('axe-core did not load in the reader.');
      const results = await axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
      return results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }));
    });
    assert.equal(violations.length, 0, `Walkthrough axe violations:\n${JSON.stringify(violations, null, 2)}`);
    console.log('PASS: full-page reader skip link, step progress, and axe WCAG A/AA checks');

    assert.equal(await page.$eval(previous, (link) => (link as HTMLAnchorElement).href), `${readerOrigin}${path}?step=request-path`);
    assert.equal(await page.$eval(next, (link) => (link as HTMLAnchorElement).href), `${readerOrigin}${path}?step=after-the-order`);
    assert.match(await page.$eval('[data-testid="step-body"]', (element) => element.textContent ?? ''), /Checkout/);
    assert.match(await page.$eval(notes, (element) => element.textContent ?? ''), /idempotency key/);
    assert.equal(await page.$('.toolbar, .inspector, .picker'), null, 'no editor controls in the reader');
    await page.click('[data-item="keys"] image');
    await page.waitForSelector(focus('keys'));
    assert.match(await page.$eval(notes, (element) => element.textContent ?? ''), /24 hours/);
    assert.equal(page.url(), `${readerOrigin}${step}`);
    await page.focus(picker);
    await page.keyboard.press('Home');
    await page.waitForFunction((selector) => (document.querySelector(selector) as HTMLSelectElement)?.value === '', {}, picker);
    await page.waitForSelector(focus('keys'), { hidden: true });
    console.log('PASS: direct step, component notes, icon click and keyboard picker');
    await page.click('nav[aria-label="Published views"] [data-view="after-the-order"]');
    await page.waitForSelector('[data-item="outbox"]');
    console.log('PASS: another published view opens without changing the step');
    assert.equal(page.url(), `${readerOrigin}${step}`);
    await page.click('[data-testid="return-to-step"]');
    await page.waitForSelector(focus('payments'));
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H2');
    await page.click('[data-step="after-the-order"]');
    await page.waitForSelector(focus('outbox'));
    await page.waitForFunction(() => document.activeElement?.tagName === 'H2');
    await page.goBack();
    await page.waitForSelector(focus('payments'));
    await page.goForward();
    await page.waitForSelector(focus('outbox'));
    assert.equal(await page.$(next), null, 'no Next step link on the last step');
    await page.click(previous);
    await page.waitForSelector(focus('payments'));
    assert.equal(page.url(), `${readerOrigin}${step}`);
    await page.click(next);
    await page.waitForSelector(focus('outbox'));
    assert.equal(page.url(), `${readerOrigin}${path}?step=after-the-order`);
    await page.goto(`${readerOrigin}${path}?step=unknown`);
    await page.waitForSelector(focus('gateway'));
    assert.equal(await page.$(previous), null, 'no Previous step link on the first step');
    assert.match(await page.$eval('.walkthrough-fallback', (element) => element.textContent ?? ''), /Showing the first step/);
    console.log('PASS: deep links, adjacent steps, canvas and keyboard selection, independent exploration, and step history');

    await page.setViewport({ width: 345, height: 720 });
    await page.goto(articleUrl);
    const approvedFrame = await (await page.waitForSelector('iframe'))?.contentFrame();
    assert.ok(approvedFrame, 'article iframe attached');
    await approvedFrame.waitForSelector('[data-testid="walkthrough"][data-embed="true"]');
    await approvedFrame.waitForSelector(focus('payments'));
    assert.equal(await approvedFrame.$eval('a[target="_blank"].link', (element) => (element as HTMLAnchorElement).href), `${readerOrigin}${step}`);
    assert.equal(await approvedFrame.$eval('.walkthrough-links a:last-child', (element) => (element as HTMLAnchorElement).href), articleUrl);
    assert.ok(await approvedFrame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no narrow horizontal overflow');
    assert.equal(await approvedFrame.$eval(stage, (element) => element.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: 10
    }))), true, 'ordinary scrolling is not captured by the diagram');
    const articleHistory = await page.evaluate(() => history.length);
    await approvedFrame.click('[data-step="after-the-order"]');
    await approvedFrame.waitForSelector(focus('outbox'));
    assert.equal(await page.evaluate(() => history.length), articleHistory, 'embed steps leave article history alone');
    assert.equal(await approvedFrame.$eval('.walkthrough-links a:first-child', (element) => (element as HTMLAnchorElement).href),
      `${readerOrigin}${path}?step=after-the-order`);
    await page.setViewport({ width: 920, height: 610 });
    await page.$eval('iframe', (frame) => { frame.height = '450'; });
    await approvedFrame.click('[data-step="charge-once"]');
    await approvedFrame.waitForSelector(focus('payments'));
    const previousZoom = await approvedFrame.$eval(stage, (element) => Number(element.getAttribute('data-zoom')));
    await approvedFrame.click('[aria-label="Zoom in"]');
    await approvedFrame.waitForFunction((selector, previous) => Number(document.querySelector(selector)?.getAttribute('data-zoom')) > previous, {}, stage, previousZoom);
    const zoomed = await approvedFrame.$eval(stage, (element) => element.getAttribute('data-zoom'));
    await approvedFrame.select(picker, 'keys');
    await approvedFrame.waitForSelector(focus('keys'));
    assert.equal(await approvedFrame.$eval(stage, (element) => element.getAttribute('data-zoom')), zoomed,
      'component notes do not re-fit the canvas in a short iframe');
    await page.goto(other.url.href);
    const blockedFrame = await (await page.waitForSelector('iframe'))?.contentFrame();
    assert.ok(blockedFrame);
    assert.match(blockedFrame.url(), /^chrome-error:/, 'Chromium blocked a different article origin');
    assert.deepEqual(errors, []);
    console.log('PASS: allowed article iframe, blocked second origin, same-step and article links, narrow layout');
  } finally {
    await browser.close();
  }
} finally {
  await Promise.all([reader.stop(true), approved.stop(true), other.stop(true)]);
  await rm(root, { recursive: true, force: true });
}
