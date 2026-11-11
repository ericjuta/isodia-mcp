import { expect, test } from 'bun:test';
import { createApp } from '../src/server/api';
import { Store } from '../src/server/store';

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body)
});

test('with a token configured the API refuses anonymous calls, while a share link stays public', async () => {
  const store = new Store(':memory:');
  const app = createApp(store, { publicUrl: 'https://diagrams.test', token: 'secret' });
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

test('an editor save against a stale revision gets 409 with the current revision, and is not applied', async () => {
  const store = new Store(':memory:');
  const app = createApp(store, { publicUrl: 'https://diagrams.test', token: undefined });
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
  const store = new Store(':memory:');
  const app = createApp(store, { publicUrl: 'https://diagrams.test', token: undefined });
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
