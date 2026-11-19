/** Prove the development handoff with real MCP clients and Chromium, without building the app. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import puppeteer from 'puppeteer-core';
import type { ServerInfo } from '../web/src/api';

const executablePath = process.env.CHROME_PATH;
if (!executablePath) throw new Error('Set CHROME_PATH to a Chrome or Chromium binary.');
const root = await mkdtemp(join(tmpdir(), 'isodia-onboarding-'));
const database = join(root, 'fresh workspace.db');
const apiSocket = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
const webSocket = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
const api = apiSocket.url.origin;
const web = `http://localhost:${webSocket.port}`;
const env: NodeJS.ProcessEnv = {
  ...process.env, HOST: '127.0.0.1', PORT: String(apiSocket.port), ISODIA_WEB_PORT: String(webSocket.port),
  ISODIA_DB: database, ISODIA_TOKEN: '', ISODIA_WALKTHROUGHS_DIR: root
};
delete env.ISODIA_URL; // The documented dev defaults must produce usable links without an override.
await Promise.all([apiSocket.stop(true), webSocket.stop(true)]);

const cwd = join(import.meta.dir, '..');
const prepared = await Bun.spawn([
  process.execPath, 'scripts/prepare-walkthrough.ts', 'docs/sample/walkthrough/checkout.isoflow.json',
  'docs/sample/walkthrough/checkout.walkthrough.json', join(root, 'checkout-architecture-v1.json')
], { cwd, stdout: 'inherit', stderr: 'inherit' }).exited;
assert.equal(prepared, 0, 'the documented sample prepares successfully');
const services = [
  Bun.spawn([process.execPath, 'src/server/index.ts', '--dev'], { cwd, env, stdout: 'inherit', stderr: 'inherit' }),
  Bun.spawn(['node', 'node_modules/vite/bin/vite.js', '--config', 'web/vite.config.ts'], { cwd, env, stdout: 'inherit', stderr: 'inherit' })
];
const client = new Client({ name: 'first-use-http', version: '0.0.0' });
const stdio = new Client({ name: 'first-use-stdio', version: '0.0.0' });
const call = (connection: Client, name: string, args: Record<string, unknown> = {}) =>
  connection.callTool({ name, arguments: args }, undefined, { timeout: 8000 }) as Promise<CallToolResult>;
const json = async <T>(connection: Client, name: string, args?: Record<string, unknown>): Promise<T> => {
  const result = await call(connection, name, args);
  const part = result.content[0];
  assert.ok(part?.type === 'text');
  assert.ok(!result.isError, part.text);
  return JSON.parse(part.text) as T;
};

async function ready(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) }).catch(() => undefined);
    if (response?.ok) return response;
    await response?.body?.cancel();
    assert.ok(services.every((child) => child.exitCode === null), `server stopped before ${url} was ready`);
    await Bun.sleep(100);
  }
  throw new Error(`${url} did not become ready`);
}

try {
  assert.equal(await (await ready(`${api}/healthz`)).text(), 'ok');
  const info: ServerInfo = await (await ready(`${web}/api/info`)).json();
  assert.equal(info.mcpUrl, `${web}/mcp`);
  assert.ok(info.stdio, 'the Bun server offers stdio MCP');
  assert.equal(info.stdio.env.ISODIA_URL, web);
  const launch = info.stdio;

  await client.connect(new StreamableHTTPClientTransport(new URL(`${api}/mcp`)));
  assert.ok((await client.listTools()).tools.some((tool) => tool.name === 'build_diagram'));
  assert.deepEqual(await json(client, 'list_projects'), []);
  const { id, url } = await json<{ id: string; url: string }>(client, 'create_project', { name: 'Event processing' });
  const built = await json<{ url: string }>(client, 'build_diagram', {
    project: id,
    nodes: [
      { id: 'collector', name: 'Collector', icon: 'server' },
      { id: 'buffer', name: 'Buffer', icon: 'queue', description: 'Absorbs bursts.' }
    ]
  });
  assert.equal(url, `${web}/p/${id}`);
  assert.equal(new URL(built.url).origin, web);

  // The copied snippets reach the same project via the development proxy and the custom SQLite file.
  const proxy = new Client({ name: 'first-use-proxy', version: '0.0.0' });
  try {
    await proxy.connect(new StreamableHTTPClientTransport(new URL(info.mcpUrl)));
    assert.deepEqual(await json(proxy, 'list_projects'), await json(client, 'list_projects'));
  } finally {
    await proxy.close();
  }
  await stdio.connect(new StdioClientTransport({ ...launch, env: { ...launch.env, ISODIA_DB: database } }));
  assert.deepEqual(await json(stdio, 'list_projects'), await json(client, 'list_projects'));
  console.log('PASS: custom ports, HTTP MCP direct and proxied, and stdio links to the same project');

  let phaseStart = performance.now();
  function timing(phase: string) {
    const now = performance.now();
    if (process.env.ISODIA_CHECK_TIMINGS === '1') {
      console.log(`TIMING ${phase}: ${Math.round(now - phaseStart)} ms`);
    }
    phaseStart = now;
  }

  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    timing('Chromium launch');
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.setViewport({ width: 1200, height: 800 });
    assert.equal((await page.goto(built.url))?.status(), 200);
    timing('editor navigation and page setup');
    const collectorIcon = '[data-item="collector"] image';
    const bufferLabel = '[data-item="buffer"] text';
    await page.waitForSelector(bufferLabel);
    await page.click(bufferLabel);
    await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('.inspector textarea')?.value === 'Absorbs bursts.');

    timing('label selection');
    await page.click('button[title="Click one item, then another (C)"]');
    await page.click(collectorIcon);
    await page.click(bufferLabel);
    await page.waitForFunction(async (project) => {
      const response = await fetch(`/api/projects/${project}`);
      const state = await response.json();
      return state.model?.views[0].connectors?.length === 1;
    }, { polling: 200 }, id);
    timing('connect and persist');
    const diagram = await json<{ connectors: { from: string; to: string }[] }>(client, 'get_diagram', { project: id });
    assert.deepEqual(diagram.connectors.map(({ from, to }) => [from, to]), [['collector', 'buffer']]);
    const png = (await call(client, 'render_diagram', { project: id, width: 800 })).content[0];
    assert.ok(png?.type === 'image' && png.mimeType === 'image/png');
    assert.equal(Buffer.from(png.data, 'base64').readUInt32BE(16), 800);
    timing('read back and render PNG');
    console.log('PASS: returned editor link, label selection, icon-to-label connection, persisted model and PNG');

    const share = await json<{ url: string; token: string }>(client, 'share_project', { project: id, action: 'create' });
    assert.equal(new URL(share.url).origin, web);
    const reader = await browser.createBrowserContext();
    const shared = await reader.newPage();
    shared.setDefaultTimeout(8000);
    assert.equal((await shared.goto(share.url))?.status(), 200);
    await shared.waitForSelector(bufferLabel);
    await shared.click(bufferLabel);
    await shared.waitForSelector('.inspector .notes');
    assert.equal(await shared.$eval('.inspector .notes', (element) => element.textContent), 'Absorbs bursts.');
    assert.equal(await shared.$('.toolbar, .inspector textarea'), null);
    const icon = await shared.$(collectorIcon);
    const box = await icon?.boundingBox();
    assert.ok(box);
    const readPan = () => shared.$eval('[data-testid="stage"]', (element) => element.getAttribute('data-pan-x'));
    const previousPan = await readPan();
    await shared.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await shared.mouse.down();
    await shared.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 30, { steps: 5 });
    await shared.mouse.up();
    assert.notEqual(await readPan(), previousPan);
    assert.equal(await shared.$eval('.inspector h3', (element) => element.textContent), 'Buffer', 'panning does not select another component');
    await json(client, 'share_project', { project: id, action: 'revoke', token: share.token });
    await shared.reload();
    await shared.waitForSelector('.empty h1');
    assert.match(await shared.$eval('.empty h1', (element) => element.textContent ?? ''), /no longer available/);
    console.log('PASS: live-share label click, notes, pan without selection change, and revocation');

    assert.equal((await page.goto(`${web}/w/checkout-architecture-v1?step=charge-once`))?.status(), 200);
    await page.waitForSelector('[data-focus="payments"]');
    console.log('PASS: sample walkthrough deep link through the custom dev proxy');
  } finally {
    await browser.close();
  }
} finally {
  await Promise.allSettled([client.close(), stdio.close()]);
  for (const service of services) service.kill();
  await Promise.all(services.map((service) => service.exited));
  await rm(root, { recursive: true, force: true });
}
