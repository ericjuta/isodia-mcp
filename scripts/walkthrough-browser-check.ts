/** CI builds dist first. Run with CHROME_PATH set to a Chromium or Chrome executable. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { prepareWalkthrough } from '../src/core/walkthrough';
import { createApp } from '../src/server/api';
import { Store } from '../src/server/store';
import model from '../docs/sample/walkthrough/checkout.isoflow.json';
import manifest from '../docs/sample/walkthrough/checkout.walkthrough.json';

const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('Set CHROME_PATH to the Chromium executable.');
const root = await mkdtemp(join(tmpdir(), 'isodia-walkthrough-browser-'));
const store = new Store(':memory:');
const path = '/w/checkout-architecture-v1';
const step = `${path}?step=charge-once`;
const embed = `${path}/embed?step=charge-once`;
const reader = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createApp(store, {
  publicUrl: 'http://127.0.0.1', token: 'scratch-browser-test', walkthroughsRoot: root,
  webRoot: join(import.meta.dir, '../dist')
}).fetch });
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
    await page.goBack();
    await page.waitForSelector(focus('payments'));
    await page.goForward();
    await page.waitForSelector(focus('outbox'));
    await page.goto(`${readerOrigin}${path}?step=unknown`);
    await page.waitForSelector(focus('gateway'));
    assert.match(await page.$eval('.walkthrough-fallback', (element) => element.textContent ?? ''), /Showing the first step/);
    console.log('PASS: deep links, canvas and keyboard selection, independent exploration, and step history');

    await page.setViewport({ width: 375, height: 720 });
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
  store.close();
  await rm(root, { recursive: true, force: true });
}
