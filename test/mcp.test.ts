import { expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { withReferencedIcons } from '../src/core/icons';
import { parseModel } from '../src/core/schema';
import { createMcpServer } from '../src/server/mcp';
import { Store } from '../src/server/store';

const CHECKOUT = {
  groups: [{ id: 'backend', name: 'Backend' }],
  nodes: [
    { id: 'shopper', name: 'Shopper', icon: 'user' },
    { id: 'api', name: 'Checkout API', icon: 'server', group: 'backend' },
    { id: 'ledger', name: 'Ledger', icon: 'storage', group: 'backend', description: 'Append only' }
  ],
  edges: [
    { from: 'shopper', to: 'api', label: 'HTTPS' },
    { from: 'api', to: 'ledger' }
  ]
};

/** A real MCP client talking to the server over an in-memory transport. */
async function connect() {
  const store = new Store(':memory:');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  await Promise.all([
    createMcpServer(store, { publicUrl: 'https://diagrams.test' }).connect(serverTransport),
    client.connect(clientTransport)
  ]);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
  const textOf = (result: CallToolResult): string => {
    const first = result.content[0];
    return first.type === 'text' ? first.text : '';
  };
  // Tool payloads are JSON of varying shape; each test asserts the fields it relies on.
  const json = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = await call(name, args);
    if (result.isError) throw new Error(textOf(result));
    return JSON.parse(textOf(result));
  };
  return { store, call, json, textOf };
}

test('an agent can create a project, build a diagram, read it back and see it', async () => {
  const { call, json } = await connect();

  const created = await json('create_project', { name: 'Checkout' });
  expect(created).toMatchObject({ id: 'checkout', url: 'https://diagrams.test/p/checkout' });

  const built = await json('build_diagram', { project: 'checkout', ...CHECKOUT });
  expect(built.items.map((item: { id: string }) => item.id)).toEqual(['shopper', 'api', 'ledger']);

  const diagram = await json('get_diagram', { project: 'checkout' });
  expect(diagram.items.find((item: { id: string }) => item.id === 'ledger')).toMatchObject({
    name: 'Ledger',
    icon: 'storage',
    description: 'Append only'
  });
  expect(diagram.connectors.map(({ from, to }: { from: string; to: string }) => `${from}>${to}`)).toEqual([
    'shopper>api',
    'api>ledger'
  ]);
  expect(diagram.regions[0]).toMatchObject({ id: 'backend', contains: ['api', 'ledger'] });

  const picture = (await call('render_diagram', { project: 'checkout', width: 800 })).content[0];
  expect(picture).toMatchObject({ type: 'image', mimeType: 'image/png' });
  const png = Buffer.from(picture.type === 'image' ? picture.data : '', 'base64');
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(800);
});

test('a failing edit comes back as a tool error naming the operation, and saves nothing', async () => {
  const { store, call, json, textOf } = await connect();
  await json('create_project', { name: 'Checkout' });
  await json('build_diagram', { project: 'checkout', ...CHECKOUT });

  const result = await call('edit_diagram', {
    project: 'checkout',
    operations: [
      { op: 'add_item', name: 'Fraud check' },
      { op: 'connect', from: 'api', to: 'missing' }
    ]
  });

  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain('Operation 2 (connect): No item "missing"');
  expect(store.getProject('checkout')).toMatchObject({ revision: 2 });
  expect(store.getProject('checkout').model.items.map((item) => item.id)).toEqual(['shopper', 'api', 'ledger']);
});

test('restore_revision undoes a rebuild', async () => {
  const { json } = await connect();
  await json('create_project', { name: 'Checkout' });
  await json('build_diagram', { project: 'checkout', ...CHECKOUT });
  await json('build_diagram', { project: 'checkout', nodes: [{ id: 'placeholder', name: 'Placeholder' }] });

  await json('restore_revision', { project: 'checkout', revision: 2 });

  const diagram = await json('get_diagram', { project: 'checkout' });
  expect(diagram.items.map((item: { id: string }) => item.id)).toEqual(['shopper', 'api', 'ledger']);
  expect(diagram.revision).toBe(4);
});

test('share links are handed out as URLs and stop resolving once revoked', async () => {
  const { store, json } = await connect();
  await json('create_project', { name: 'Checkout' });

  const link = await json('share_project', { project: 'checkout', action: 'create', view: 'Overview' });
  expect(link.url).toBe(`https://diagrams.test/s/${link.token}`);
  expect(store.resolveShareLink(link.token)).toMatchObject({ project: { id: 'checkout' }, viewId: 'overview' });

  const remaining = await json('share_project', { project: 'checkout', action: 'revoke', token: link.token });
  expect(remaining).toEqual([]);
  expect(() => store.resolveShareLink(link.token)).toThrow('Unknown share link.');
});

test('views can be created, renamed, copied and deleted through the tools', async () => {
  const { json } = await connect();
  await json('create_project', { name: 'Checkout' });
  await json('build_diagram', { project: 'checkout', ...CHECKOUT });

  const created = await json('manage_views', { project: 'checkout', action: 'create', name: 'Audit view' });
  expect(created.views.map((view: { id: string }) => view.id)).toEqual(['overview', 'audit-view']);
  expect(created.views[1].items).toBe(0);

  const copied = await json('manage_views', {
    project: 'checkout',
    action: 'create',
    name: 'Client view',
    copyFrom: 'Audit view'
  });
  expect(copied.views[2]).toMatchObject({ id: 'client-view', name: 'Client view', items: 0 });

  const fromOverview = await json('manage_views', {
    project: 'checkout',
    action: 'create',
    name: 'Deep dive',
    copyFrom: 'overview'
  });
  expect(fromOverview.views[3].items).toBe(3);

  const renamed = await json('manage_views', { project: 'checkout', action: 'update', view: 'audit-view', name: 'Compliance' });
  expect(renamed.views.map((view: { name: string }) => view.name)).toContain('Compliance');

  const deleted = await json('manage_views', { project: 'checkout', action: 'delete', view: 'deep-dive' });
  expect(deleted.views.map((view: { id: string }) => view.id)).toEqual(['overview', 'audit-view', 'client-view']);
});

test('a standalone export is a file the editor accepts, and it imports back as the same diagram', async () => {
  const { json } = await connect();
  await json('create_project', { name: 'Checkout' });
  await json('build_diagram', { project: 'checkout', ...CHECKOUT });

  const exported = await json('export_project', { project: 'checkout', standalone: true });
  expect(parseModel(exported).icons.map((icon) => icon.id).sort()).toEqual(['server', 'storage', 'user']);

  const imported = await json('import_project', { model: exported });
  expect(imported.id).toBe('checkout-2');
  const [original, copy] = await Promise.all([
    json('get_diagram', { project: 'checkout' }),
    json('get_diagram', { project: 'checkout-2' })
  ]);
  for (const part of ['items', 'connectors', 'regions', 'texts']) {
    expect(copy[part]).toEqual(original[part]);
  }
  expect(withReferencedIcons(parseModel(exported)).title).toBe('Checkout');
});
