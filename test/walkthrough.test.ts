import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWalkthrough, prepareWalkthrough, WALKTHROUGH_MAX_BYTES } from '../src/core/walkthrough';
import { createApp } from '../src/server/api';
import { loadConfig } from '../src/server/config';
import { Store } from '../src/server/store';

const model = {
  title: 'Private checkout title',
  version: 'private',
  description: 'Private project summary',
  items: [
    { id: 'web', name: 'Web', description: '<p>Browser entry point.</p>', icon: 'server' },
    { id: 'worker', name: 'Worker', icon: 'queue' },
    { id: 'private', name: 'Private service', description: 'Private runbook', icon: 'private-icon' }
  ],
  views: [
    { id: 'overview', name: 'Overview', lastUpdated: '2026-11-18T15:00:00Z', items: [{ id: 'web', tile: { x: 0, y: 0 } }] },
    { id: 'jobs', name: 'Jobs', items: [{ id: 'worker', tile: { x: 2, y: 0 } }], rectangles: [{ id: 'zone', from: { x: 0, y: 0 }, to: { x: 3, y: 1 }, color: 'zone-color' }] },
    { id: 'ops', name: 'Private ops', items: [{ id: 'private', tile: { x: 0, y: 0 } }] }
  ],
  icons: [{ id: 'private-icon', name: 'RUN BOOK', url: 'data:image/png;base64,AAAA' }],
  colors: [{ id: 'zone-color', value: '#ffffee' }, { id: 'unused', value: '#000000' }]
};
const step = { id: 'work', title: 'Do the work', body: 'Process asynchronously.', view: 'jobs', component: 'worker' };
const manifest = {
  schemaVersion: 1, title: 'How checkout works', articleUrl: 'https://blog.example:8443/posts/checkout#steps',
  views: ['jobs', 'overview'], steps: [step]
};

test('preparation preserves author view order, includes referenced data only, and freezes artwork', () => {
  const snapshot = prepareWalkthrough(model, manifest);
  expect(snapshot.model.title).toBe(manifest.title);
  expect(snapshot.model.version).toBeUndefined();
  expect(snapshot.model.views.map(({ id }) => id)).toEqual(['jobs', 'overview']);
  expect(snapshot.model.items.map(({ id }) => id)).toEqual(['web', 'worker']);
  expect(snapshot.model.items[0].description).toBe('<p>Browser entry point.</p>');
  expect(snapshot.model.icons.map(({ id }) => id)).toEqual(['server', 'queue']);
  expect(snapshot.model.colors.map(({ id }) => id)).toEqual(['zone-color']);
  expect(JSON.stringify(snapshot)).not.toMatch(/Private|private-icon|lastUpdated|unused/);
  expect(parseWalkthrough(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
});

test('refuses broken step references, invalid article origins and unprojected or incomplete snapshots', () => {
  expect(() => prepareWalkthrough(model, { ...manifest, steps: [step, step] })).toThrow(/Duplicate step/);
  expect(() => prepareWalkthrough(model, { ...manifest, views: ['jobs', 'jobs'] })).toThrow(/duplicate/);
  expect(() => prepareWalkthrough(model, { ...manifest, views: ['jobs', 'unknown'] })).toThrow(/Unknown published view/);
  expect(() => prepareWalkthrough(model, { ...manifest, steps: [{ ...step, view: 'ops' }] })).toThrow(/not included/);
  expect(() => prepareWalkthrough(model, { ...manifest, steps: [{ ...step, component: 'web' }] })).toThrow(/not in view/);
  for (const articleUrl of ['javascript:void(0)', '//blog.example', 'http://blog.example', 'https://user@blog.example', 'https://blog.example;test', 'http://[::1]:8080/']) {
    expect(() => prepareWalkthrough(model, { ...manifest, articleUrl })).toThrow(/absolute HTTPS/);
  }
  expect(prepareWalkthrough(model, { ...manifest, articleUrl: 'http://localhost:8080/' }).articleUrl).toBe('http://localhost:8080/');
  const snapshot = prepareWalkthrough(model, manifest);
  expect(() => parseWalkthrough({ ...snapshot, model })).toThrow(/outside the publication projection/);
  expect(() => parseWalkthrough({ ...snapshot, model: { ...snapshot.model, icons: [] } })).toThrow(/referenced icons/);
});

test('publication routes are read-only, isolated from projects, frame-scoped and withdrawable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'isodia-publication-'));
  const store = new Store(':memory:');
  try {
    const project = store.createProject({ name: 'Private live project' }, 'api');
    const privateShare = store.createShareLink(project.id);
    const config = { publicUrl: 'https://diagrams.example', token: 'secret', webRoot: root };
    const app = createApp(store, { ...config, walkthroughsRoot: root });
    const snapshot = prepareWalkthrough(model, manifest);
    writeFileSync(join(root, 'index.html'), '<title>Reader shell</title>');
    writeFileSync(join(root, 'checkout-v1.json'), JSON.stringify(snapshot));
    writeFileSync(join(root, 'invalid.json'), JSON.stringify({ ...snapshot, model }));
    writeFileSync(join(root, 'oversize.json'), ' '.repeat(WALKTHROUGH_MAX_BYTES + 1));
    symlinkSync(join(root, 'checkout-v1.json'), join(root, 'alias.json'));
    expect(loadConfig({ ISODIA_WALKTHROUGHS_DIR: root }).walkthroughsRoot).toBe(root);
    expect((await createApp(store, config).request('/api/walkthroughs/checkout-v1')).status).toBe(404);
    expect((await app.request(`/api/projects/${project.id}`)).status).toBe(401);
    expect((await app.request(`/api/shared/${privateShare.token}`)).status).toBe(200);
    const data = await app.request('/api/walkthroughs/checkout-v1');
    expect(data.headers.get('cache-control')).toBe('no-store');
    expect(await data.json()).toEqual(snapshot);
    expect((await app.request('/api/walkthroughs/checkout-v1', { method: 'POST' })).status).toBe(404);
    for (const id of ['invalid', 'oversize', 'alias', 'other', 'checkout%2fv1']) {
      const unavailable = await app.request(`/api/walkthroughs/${id}`);
      expect(unavailable.status).toBe(404);
      expect(await unavailable.text()).toBe('{"error":"Walkthrough not available."}');
    }
    const embed = await app.request('/w/checkout-v1/embed?step=work');
    expect(embed.status).toBe(200);
    expect(embed.headers.get('content-security-policy')).toBe('frame-ancestors https://blog.example:8443');
    expect(embed.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await embed.text()).toContain('Reader shell');
    const full = await app.request('/w/checkout-v1?step=work');
    expect(full.status).toBe(200);
    expect(full.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect((await app.request('/w/checkout-v1/else')).status).toBe(404);
    rmSync(join(root, 'checkout-v1.json'));
    expect((await app.request('/api/walkthroughs/checkout-v1')).status).toBe(404);
    const withdrawn = await app.request('/w/checkout-v1/embed');
    expect(withdrawn.status).toBe(404);
    expect(withdrawn.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('the preparation command refuses unsafe names and never overwrites a publication', () => {
  const root = mkdtempSync(join(tmpdir(), 'isodia-walkthrough-cli-'));
  try {
    const modelPath = join(root, 'model.json');
    const manifestPath = join(root, 'manifest.json');
    const publicationPath = join(root, 'checkout-v1.json');
    writeFileSync(modelPath, JSON.stringify(model));
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const prepare = (name: string) => Bun.spawnSync([
      process.execPath, join(import.meta.dir, '../scripts/prepare-walkthrough.ts'), modelPath, manifestPath, name
    ]);
    const invalid = prepare(join(root, 'Not a slug.json'));
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr.toString()).toContain('lowercase publication slug');
    expect(prepare(publicationPath).exitCode).toBe(0);
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, title: 'An updated story' }));
    expect(prepare(publicationPath).exitCode).toBe(1);
    expect(JSON.parse(readFileSync(publicationPath, 'utf8')).title).toBe(manifest.title);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
