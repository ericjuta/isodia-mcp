import { expect, test } from 'bun:test';
import { createApp } from '../src/server/api';
import { emptyModel } from '../src/core/model';
import { svgToPng } from '../src/core/png';
import { assertSafeToListen, loadConfig } from '../src/server/config';
import { openSqlite } from '../src/server/sqlite';
import { Store } from '../src/server/store';

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body)
});

test('with a token configured the API refuses anonymous calls, while a share link stays public', async () => {
  const store = new Store(openSqlite(':memory:'));
  const app = createApp(store, { publicUrl: 'https://diagrams.test', token: 'secret', rasterize: svgToPng });
  const { id } = store.createProject({ name: 'Shop' }, 'api');
  const { token } = store.createShareLink(id);
  const authorized = { authorization: 'Bearer secret' };

  expect((await app.request('/api/projects')).status).toBe(401);
  expect((await app.request('/api/projects', { headers: { authorization: 'Bearer wrong!' } })).status).toBe(401);
  expect((await app.request('/mcp', json({}))).status).toBe(401);
  expect((await app.request('/api/projects', { headers: authorized })).status).toBe(200);

  const shared = await app.request(`/api/shared/${token}`);
  expect(shared.status).toBe(200);
  expect(await shared.json()).toMatchObject({ name: 'Shop', revision: 1 });
  expect((await app.request('/api/shared/not-a-token')).status).toBe(404);
});

test('the health route answers without the token and says nothing about projects', async () => {
  const app = createApp(new Store(openSqlite(':memory:')), { publicUrl: 'https://diagrams.test', token: 'secret', rasterize: svgToPng });
  const response = await app.request('/healthz');
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('ok');
});

test('a custom icon must carry its picture inline: paths and remote addresses are refused', async () => {
  const store = new Store(openSqlite(':memory:'));
  const app = createApp(store, { publicUrl: 'https://diagrams.test', token: undefined, rasterize: svgToPng });
  const withIcon = (url: string) => ({
    name: 'Leak',
    model: { ...emptyModel('Leak'), icons: [{ id: 'x', name: 'X', url }], items: [{ id: 'a', name: 'A', icon: 'x' }] }
  });

  for (const url of ['/etc/hostname.png', 'file:///etc/hostname.png', 'https://example.com/a.png', 'data:text/html,<p>']) {
    expect((await app.request('/api/projects', json(withIcon(url)))).status).toBe(400);
  }
  expect(store.listProjects()).toEqual([]);
  expect((await app.request('/api/projects', json(withIcon('data:image/png;base64,AAAA')))).status).toBe(201);
});

test('a networked host without a token keeps private routes closed while public ones still answer', async () => {
  const store = new Store(openSqlite(':memory:'));
  const app = createApp(store, { publicUrl: 'https://diagrams.test', token: undefined, requireToken: true, rasterize: svgToPng });
  const { id } = store.createProject({ name: 'Shop' }, 'api');
  const { token } = store.createShareLink(id);

  for (const [path, init] of [['/api/projects'], ['/api/info'], [`/api/projects/${id}`], ['/mcp', json({})]] as const) {
    const closed = await app.request(path, init);
    expect(closed.status).toBe(503);
    expect(await closed.json()).toEqual({ error: expect.stringContaining('ISODIA_TOKEN') });
  }
  expect((await app.request('/healthz')).status).toBe(200);
  expect((await app.request(`/api/shared/${token}`)).status).toBe(200);
});

test('connection details offer stdio only where the host can start it', async () => {
  const config = { publicUrl: 'https://diagrams.test', token: undefined, rasterize: svgToPng };
  const remote = await (await createApp(new Store(openSqlite(':memory:')), config).request('/api/info')).json();
  expect(remote).toEqual({ version: expect.any(String), mcpUrl: 'https://diagrams.test/mcp', tokenRequired: false });

  const stdio = { command: 'bun', args: ['/srv/isodia/src/server/mcp-stdio.ts'] };
  const local = await (await createApp(new Store(openSqlite(':memory:')), { ...config, stdio }).request('/api/info')).json();
  expect(local).toMatchObject({
    stdioCommand: 'bun /srv/isodia/src/server/mcp-stdio.ts',
    stdio: { ...stdio, env: { ISODIA_URL: 'https://diagrams.test' } }
  });
});

test('the server is local by default and will not serve other machines without a token', () => {
  expect(loadConfig({}).host).toBe('127.0.0.1');
  expect(() => assertSafeToListen(loadConfig({}))).not.toThrow();
  expect(() => assertSafeToListen(loadConfig({ HOST: '0.0.0.0' }))).toThrow(/ISODIA_TOKEN/);
  expect(() => assertSafeToListen(loadConfig({ HOST: '0.0.0.0', ISODIA_TOKEN: 's' }))).not.toThrow();
});

test('development links use the web port without changing the API listener or production links', () => {
  const env = { PORT: '4510', ISODIA_WEB_PORT: '4511' };
  expect(loadConfig({}, true)).toMatchObject({ port: 4400, publicUrl: 'http://localhost:4401' });
  expect(loadConfig(env, true)).toMatchObject({ port: 4510, publicUrl: 'http://localhost:4511' });
  expect(loadConfig(env)).toMatchObject({ port: 4510, publicUrl: 'http://localhost:4510' });
  expect(loadConfig({ ...env, ISODIA_URL: 'https://diagrams.test/' }, true).publicUrl).toBe('https://diagrams.test');
});

test('an editor save against a stale revision gets 409 with the current revision, and is not applied', async () => {
  const store = new Store(openSqlite(':memory:'));
  const app = createApp(store, { publicUrl: 'https://diagrams.test', token: undefined, rasterize: svgToPng });
  const project = store.createProject({ name: 'Shop' }, 'api');
  await app.request(`/api/projects/${project.id}/operations`, json({ operations: [{ op: 'add_item', name: 'Agent item' }] }));

  const stale = await app.request(`/api/projects/${project.id}/model`, {
    ...json({ model: { ...project.model, description: 'stale editor' }, baseRevision: 1 }),
    method: 'PUT'
  });

  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ currentRevision: 2 });
  expect(store.getProject(project.id).model).toMatchObject({ items: [{ id: 'agent-item' }] });
  expect(store.getProject(project.id).model.description).toBeUndefined();
});

test('bad input is a 400 that says what is wrong, not a 500', async () => {
  const store = new Store(openSqlite(':memory:'));
  const app = createApp(store, { publicUrl: 'https://diagrams.test', token: undefined, rasterize: svgToPng });
  const { id } = store.createProject({ name: 'Shop' }, 'api');

  const unknownIcon = await app.request(
    `/api/projects/${id}/operations`,
    json({ operations: [{ op: 'add_item', name: 'X', icon: 'no-such-icon' }] })
  );
  const malformed = await app.request(`/api/projects/${id}/operations`, json({ operations: [{ op: 'explode' }] }));

  expect(unknownIcon.status).toBe(400);
  expect(await unknownIcon.json()).toEqual({ error: expect.stringContaining('Unknown icon "no-such-icon"') });
  expect(malformed.status).toBe(400);
});
