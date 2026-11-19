/**
 * Prove the Cloudflare target in workerd, the Workers runtime, through real HTTP and MCP clients.
 *
 *   bun scripts/worker-runtime-check.ts           runs the Worker on the dev server (no Worker build)
 *   bun scripts/worker-runtime-check.ts --built   builds it with `cf build` and runs the build output
 *
 * Both need the web app in dist/ (`bun run build`) and Node.js 22.18 or later for cf and Vite.
 * With --built, CHROME_PATH must name a Chrome or Chromium binary for the article-embed check.
 * Local Durable Object data lives in a scratch directory and is deleted afterwards.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import puppeteer from 'puppeteer-core';
import { prepareWalkthrough } from '../src/core/walkthrough';
import model from '../docs/sample/walkthrough/checkout.isoflow.json';
import manifest from '../docs/sample/walkthrough/checkout.walkthrough.json';

const built = process.argv.includes('--built');
const executablePath = process.env.CHROME_PATH;
if (built && !executablePath) throw new Error('Set CHROME_PATH to a Chrome or Chromium binary.');
const cwd = join(import.meta.dir, '..');
const root = await mkdtemp(join(tmpdir(), 'isodia-worker-'));
const publications = join(root, 'publications');
const token = 'scratch-worker-token';
const authorized = { authorization: `Bearer ${token}` };
const publication = 'checkout-architecture-v1';

const article = (framePath: () => string) => Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(
  `<meta name="viewport" content="width=device-width, initial-scale=1"><iframe title="Checkout walkthrough" src="${framePath()}" width="100%" height="560" style="border:0"></iframe>`,
  { headers: { 'content-type': 'text/html' } }
) });
let worker = '';
const approved = article(() => `${worker}/w/${publication}/embed?step=charge-once`);
const other = article(() => `${worker}/w/${publication}/embed?step=charge-once`);
const articleUrl = `${approved.url.origin}/checkout#architecture`;

const env = (withToken: boolean): Record<string, string> => {
  const values: Record<string, string> = {
    ...(process.env as Record<string, string>),
    CF_SEND_TELEMETRY: 'false',
    ISODIA_CLOUDFLARE_STATE: join(root, 'state'),
    ISODIA_WALKTHROUGHS_DIR: publications
  };
  delete values.ISODIA_TOKEN;
  if (withToken) values.ISODIA_TOKEN = token;
  return values;
};

/** Start the Worker; `withToken: false` runs it as an operator would before setting the secret. */
async function start(withToken: boolean): Promise<{ stop(): Promise<void> }> {
  // A free port: bind one, note it, release it.
  const socket = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = socket.url.port;
  await socket.stop(true);
  const vite = ['node', 'node_modules/vite/bin/vite.js', ...(built ? ['preview'] : []), '--host', '127.0.0.1', '--port', port, '--strictPort', '--logLevel', 'warn'];
  const child = Bun.spawn(vite, { cwd, env: env(withToken), stdout: 'inherit', stderr: 'inherit' });
  worker = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 300; attempt++) {
    const response = await fetch(`${worker}/healthz`, { signal: AbortSignal.timeout(2000) }).catch(() => undefined);
    if (response?.ok) {
      assert.equal(await response.text(), 'ok');
      return {
        async stop() {
          child.kill();
          await child.exited;
        }
      };
    }
    await response?.body?.cancel();
    assert.equal(child.exitCode, null, 'the Worker stopped before it answered');
    await Bun.sleep(100);
  }
  child.kill();
  throw new Error('The Worker did not answer /healthz');
}

const api = (path: string, init: RequestInit = {}) => fetch(`${worker}${path}`, {
  ...init,
  headers: { ...authorized, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers }
});
const pngWidth = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(16);

try {
  await mkdir(publications);
  await writeFile(join(publications, `${publication}.json`), JSON.stringify(prepareWalkthrough(model, { ...manifest, articleUrl })));

  if (built) {
    const exit = await Bun.spawn(['node_modules/.bin/cf', 'build'], { cwd, env: env(false), stdout: 'inherit', stderr: 'inherit' }).exited;
    assert.equal(exit, 0, 'cf build succeeds');
    const output = join(cwd, '.cloudflare/output/v1');
    let bytes = 0;
    for (const entry of await readdir(output, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && /\.(m?js|wasm)$/.test(entry.name) && !entry.parentPath.includes('assets')) {
        bytes += (await stat(join(entry.parentPath, entry.name))).size;
      }
    }
    console.log(`MEASURE: Worker modules in Build Output: ${(bytes / 1024 / 1024).toFixed(2)} MiB uncompressed`);
  }

  // 1. A configured Worker: private routes need the token, the workspace keeps every rule.
  let server = await start(true);
  let shareToken: string;
  let projectId: string;
  try {
    assert.equal((await fetch(`${worker}/api/projects`)).status, 401);
    assert.equal((await fetch(`${worker}/mcp`, { method: 'POST', body: '{}' })).status, 401);
    const info = await (await api('/api/info')).json();
    assert.deepEqual(info, { version: info.version, mcpUrl: `${worker}/mcp`, tokenRequired: true }, 'no stdio offer on Cloudflare');

    const client = new Client({ name: 'worker-runtime-check', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${worker}/mcp`), { requestInit: { headers: authorized } }));
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = (await client.callTool({ name, arguments: args }, undefined, { timeout: 30_000 })) as CallToolResult;
      assert.ok(!result.isError, JSON.stringify(result.content));
      return result;
    };
    const text = (result: CallToolResult) => (result.content[0]?.type === 'text' ? result.content[0].text : '');
    const created = JSON.parse(text(await call('create_project', { name: 'Event processing' })));
    projectId = created.id;
    assert.equal(created.url, `${worker}/p/${projectId}`);
    await call('build_diagram', {
      project: projectId,
      nodes: [
        { id: 'collector', name: 'Collector', icon: 'server' },
        { id: 'buffer', name: 'Buffer', icon: 'queue', description: 'Absorbs bursts.' },
        { id: 'store', name: 'Événements 東京', icon: 'storage' }
      ],
      edges: [{ from: 'collector', to: 'buffer', label: 'HTTPS' }, { from: 'buffer', to: 'store' }]
    });
    const picture = (await call('render_diagram', { project: projectId, width: 800 })).content[0];
    assert.ok(picture?.type === 'image' && picture.mimeType === 'image/png');
    assert.equal(pngWidth(Uint8Array.from(atob(picture.data), (char) => char.charCodeAt(0))), 800);
    await client.close();
    console.log('PASS: token guard, connection details, and MCP create, build and PNG render in workerd');

    const started = performance.now();
    const export2400 = await api(`/api/projects/${projectId}/render?width=2400`);
    const png = new Uint8Array(await export2400.arrayBuffer());
    const renderMs = performance.now() - started;
    assert.equal(export2400.status, 200);
    assert.equal(pngWidth(png), 2400);
    console.log(`MEASURE: 2400px PNG export: ${png.length} bytes in ${renderMs.toFixed(0)} ms wall time (local workerd)`);

    const project = await (await api(`/api/projects/${projectId}`)).json();
    const edited = { ...project.model, description: 'Edited in the browser' };
    const saved = await api(`/api/projects/${projectId}/model`, { method: 'PUT', body: JSON.stringify({ model: edited, baseRevision: project.revision }) });
    assert.equal(saved.status, 200);
    const { revision } = await saved.json();
    const stale = await api(`/api/projects/${projectId}/model`, { method: 'PUT', body: JSON.stringify({ model: project.model, baseRevision: project.revision }) });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).currentRevision, revision);
    assert.equal((await (await api(`/api/projects/${projectId}`)).json()).model.description, 'Edited in the browser');
    assert.equal((await api(`/api/projects/${projectId}/checkpoints`, { method: 'POST', body: JSON.stringify({ label: 'Reviewed' }) })).status, 201);

    const oversized = { ...edited, icons: [{ id: 'huge', name: 'Huge', url: `data:image/png;base64,${'A'.repeat(9 * 1024 * 1024)}` }] };
    const refused = await api(`/api/projects/${projectId}/model`, { method: 'PUT', body: JSON.stringify({ model: oversized, baseRevision: revision }) });
    assert.equal(refused.status, 413);
    assert.equal((await (await api(`/api/projects/${projectId}/revision`)).json()).revision, revision, 'a refused write changes nothing');
    console.log('PASS: editor save, stale-write 409, checkpoint, and an over-limit row refused with 413 and rolled back');

    const share = await (await api(`/api/projects/${projectId}/shares`, { method: 'POST', body: '{}' })).json();
    shareToken = share.token;
    const shared = await fetch(`${worker}/api/shared/${shareToken}`);
    assert.equal(shared.status, 200);
    assert.equal((await shared.json()).model.description, 'Edited in the browser');

    // Deleting a project must take its history and share links with it: a project created
    // later under the same id must not inherit either.
    const doomed = await (await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Short lived' }) })).json();
    const doomedShare = await (await api(`/api/projects/${doomed.id}/shares`, { method: 'POST', body: '{}' })).json();
    assert.equal((await api(`/api/projects/${doomed.id}`, { method: 'DELETE' })).status, 204);
    const reborn = await (await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Short lived' }) })).json();
    assert.equal(reborn.id, doomed.id);
    assert.equal((await fetch(`${worker}/api/shared/${doomedShare.token}`)).status, 404);
    assert.deepEqual((await (await api(`/api/projects/${reborn.id}/revisions`)).json()).map((entry: { number: number }) => entry.number), [1]);
    console.log('PASS: public share, and deletion cascades to history and share links');

    const embed = await fetch(`${worker}/w/${publication}/embed?step=charge-once`);
    assert.equal(embed.status, 200);
    assert.equal(embed.headers.get('content-security-policy'), `frame-ancestors ${approved.url.origin}`);
    assert.equal(embed.headers.get('cache-control'), 'no-store');
    assert.equal(embed.headers.get('referrer-policy'), 'no-referrer');
    assert.match(await embed.text(), /<div id="root">/);
    const standalone = await fetch(`${worker}/w/${publication}?step=charge-once`);
    assert.equal(standalone.headers.get('content-security-policy'), "frame-ancestors 'none'");
    const data = await fetch(`${worker}/api/walkthroughs/${publication}`);
    assert.equal(data.status, 200);
    assert.equal((await data.json()).articleUrl, articleUrl);
    for (const path of [`/w/unknown`, `/w/unknown/embed`, `/api/walkthroughs/unknown`, `/w/${publication}/other`]) {
      const missing = await fetch(`${worker}${path}`);
      assert.equal(missing.status, 404, path);
      await missing.body?.cancel();
    }
    // Publications are bundled into the Worker, not shipped as files: no path returns one raw.
    for (const path of [`/${publication}.json`, `/publications/${publication}.json`, `/w/${publication}.json`]) {
      const raw = await fetch(`${worker}${path}`);
      assert.doesNotMatch(await raw.text(), /"schemaVersion"/, path);
    }
    console.log('PASS: reader routes with frame policy, unknown publications 404, no raw publication file');

    if (executablePath) {
      const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
      try {
        const page = await browser.newPage();
        page.setDefaultTimeout(10_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(articleUrl);
        const frame = await (await page.waitForSelector('iframe'))?.contentFrame();
        assert.ok(frame, 'article iframe attached');
        await frame.waitForSelector('[data-testid="walkthrough"][data-embed="true"]');
        await frame.waitForSelector('[data-focus="payments"]');
        await page.goto(other.url.href);
        const blocked = await (await page.waitForSelector('iframe'))?.contentFrame();
        assert.ok(blocked);
        assert.match(blocked.url(), /^chrome-error:/, 'Chromium blocked a different article origin');
        assert.deepEqual(errors, []);
        console.log('PASS: Chromium renders the step in the approved article and blocks another origin');
      } finally {
        await browser.close();
      }
    } else {
      console.log('SKIP: Chromium embed check (CHROME_PATH is not set)');
    }
  } finally {
    await server.stop();
  }

  // 2. The same storage, opened by a new Worker process: nothing was held only in memory.
  server = await start(true);
  try {
    const project = await (await api(`/api/projects/${projectId}`)).json();
    assert.equal(project.model.description, 'Edited in the browser');
    const history = await (await api(`/api/projects/${projectId}/revisions`)).json();
    assert.ok(history.some((entry: { label: string | null }) => entry.label === 'Reviewed'), 'the checkpoint survives');
    assert.equal((await fetch(`${worker}/api/shared/${shareToken}`)).status, 200);
    assert.equal((await api(`/api/shares/${shareToken}`, { method: 'DELETE' })).status, 204);
    const revoked = await fetch(`${worker}/api/shared/${shareToken}`);
    assert.equal(revoked.status, 404);
    console.log('PASS: project, history and share survive a restart; revocation takes effect');
  } finally {
    await server.stop();
  }

  // 3. No token yet: private routes stay closed rather than open; public routes still answer.
  server = await start(false);
  try {
    for (const [path, init] of [['/api/projects', {}], ['/api/info', {}], ['/mcp', { method: 'POST', body: '{}' }]] as const) {
      const closed = await fetch(`${worker}${path}`, init);
      assert.equal(closed.status, 503, path);
      assert.match((await closed.json()).error, /ISODIA_TOKEN/);
    }
    assert.equal((await fetch(`${worker}/w/${publication}`)).status, 200);
    console.log('PASS: without ISODIA_TOKEN private routes answer 503; health and walkthroughs stay public');
  } finally {
    await server.stop();
  }
  console.log(`PASS: Cloudflare Worker runtime check (${built ? 'built Worker' : 'dev server'})`);
} finally {
  await Promise.all([approved.stop(true), other.stop(true)]);
  await rm(root, { recursive: true, force: true });
}
