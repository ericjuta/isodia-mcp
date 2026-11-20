import { afterEach, expect, test } from 'bun:test';
import type { Walkthrough } from '../src/core/walkthrough';
import { buildListStepsPayload, buildReadStepPayload, registerWalkthroughTools } from '../web/src/walkthrough-webmcp';

const story: Walkthrough = {
  schemaVersion: 1,
  title: 'Checkout architecture',
  articleUrl: 'https://blog.example/checkout',
  steps: [
    { id: 'start', title: 'Start checkout', body: 'The browser opens checkout.', view: 'request' },
    { id: 'charge', title: 'Charge the order', body: 'Payments records the charge.', view: 'billing', component: 'payments' }
  ],
  model: {
    title: 'Checkout architecture',
    items: [
      { id: 'browser', name: 'Browser' },
      { id: 'payments', name: 'Payments', description: '<p>Check <strong>fees &amp; tax</strong>.</p><p>Record the charge.</p>' },
      { id: 'orders', name: 'Orders' }
    ],
    views: [
      { id: 'request', name: 'Request path', items: [{ id: 'browser', tile: { x: 0, y: 0 } }] },
      { id: 'billing', name: 'Billing', items: [{ id: 'orders', tile: { x: 2, y: 0 } }, { id: 'payments', tile: { x: 0, y: 0 } }] }
    ],
    icons: [],
    colors: []
  }
};

const pageUrl = new URL('https://diagrams.example:8443/w/checkout-v1/embed?step=start#details');
const startPayload = {
  id: 'start', title: 'Start checkout', body: 'The browser opens checkout.',
  view: { id: 'request', name: 'Request path' }, components: ['Browser']
};
const chargePayload = {
  id: 'charge', title: 'Charge the order', body: 'Payments records the charge.',
  view: { id: 'billing', name: 'Billing' },
  component: { id: 'payments', name: 'Payments', notes: 'Check fees & tax.\nRecord the charge.' },
  components: ['Orders', 'Payments']
};

const restoreGlobals: Array<() => void> = [];
function setGlobal(key: 'navigator' | 'document' | 'location', value: unknown) {
  const original = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, value });
  restoreGlobals.push(() => {
    if (original) Object.defineProperty(globalThis, key, original);
    else Reflect.deleteProperty(globalThis, key);
  });
}
afterEach(() => {
  for (const restore of restoreGlobals.splice(0).reverse()) restore();
});

type RegisteredTool = {
  name: string;
  inputSchema: { type: string; properties: Record<string, { type: string }>; required?: string[]; additionalProperties: boolean };
  annotations: { readOnlyHint: boolean };
  execute: (input?: { stepId?: string }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
};
const options = { story, currentStepId: () => 'start', goToStep: () => {} };

test('lists steps in story order with one-based indexes and absolute links', () => {
  expect(buildListStepsPayload(story, 'charge', pageUrl)).toEqual({
    title: 'Checkout architecture', articleUrl: 'https://blog.example/checkout', currentStepId: 'charge',
    steps: [
      { id: 'start', index: 1, title: 'Start checkout', view: 'request', url: 'https://diagrams.example:8443/w/checkout-v1/embed?step=start' },
      { id: 'charge', index: 2, title: 'Charge the order', view: 'billing', url: 'https://diagrams.example:8443/w/checkout-v1/embed?step=charge' }
    ]
  });
});

test('reads the step view and its components, with plain text notes for the focused component', () => {
  expect(buildReadStepPayload(story, 'start')).toEqual(startPayload);
  expect(buildReadStepPayload(story, 'charge')).toEqual(chargePayload);
});

test('lists valid ids for an unknown step', () => {
  const payload = buildReadStepPayload(story, 'missing');
  expect(payload.error).toContain('missing');
  expect(payload.validStepIds).toEqual(['start', 'charge']);
});

test('registers three read-only tools and removes them via the legacy WebMCP API', async () => {
  const tools = new Map<string, RegisteredTool>();
  setGlobal('navigator', { modelContext: {
    registerTool(tool: RegisteredTool) { tools.set(tool.name, tool); },
    unregisterTool(name: string) { tools.delete(name); }
  } });
  setGlobal('location', pageUrl);
  let current = 'start';
  const navigated: string[] = [];
  const cleanup = registerWalkthroughTools({
    story,
    currentStepId: () => current,
    goToStep: (id) => { navigated.push(id); current = id; }
  });
  try {
    expect([...tools.keys()].sort()).toEqual(['go_to_step', 'list_steps', 'read_step']);
    for (const tool of tools.values()) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
    const list = tools.get('list_steps')!;
    const read = tools.get('read_step')!;
    const go = tools.get('go_to_step')!;
    expect(list.inputSchema.properties).toEqual({});
    expect(read.inputSchema.properties.stepId.type).toBe('string');
    expect(read.inputSchema.required ?? []).toEqual([]);
    expect(go.inputSchema.properties.stepId.type).toBe('string');
    expect(go.inputSchema.required).toEqual(['stepId']);

    const listing = await list.execute({});
    expect(listing.isError).not.toBe(true);
    expect(listing.content[0].type).toBe('text');
    expect(JSON.parse(listing.content[0].text).currentStepId).toBe('start');
    expect(JSON.parse(listing.content[0].text).steps[1].url).toBe('https://diagrams.example:8443/w/checkout-v1/embed?step=charge');
    expect(JSON.parse((await read.execute()).content[0].text)).toEqual(startPayload);
    const explicit = await read.execute({ stepId: 'charge' });
    expect(JSON.parse(explicit.content[0].text)).toEqual(chargePayload);

    for (const error of [await read.execute({ stepId: 'missing' }), await go.execute({ stepId: 'missing' }), await go.execute({})]) {
      expect(error.isError).toBe(true);
      expect(error.content[0].type).toBe('text');
      expect(JSON.parse(error.content[0].text).validStepIds).toEqual(['start', 'charge']);
    }
    expect(navigated).toEqual([]);
    expect(await go.execute({ stepId: 'charge' })).toEqual(explicit);
    expect(navigated).toEqual(['charge']);
    expect(JSON.parse((await read.execute({})).content[0].text)).toEqual(chargePayload);
    expect(JSON.parse((await list.execute({})).content[0].text).currentStepId).toBe('charge');
  } finally {
    cleanup();
  }
  expect([...tools.keys()]).toEqual([]);
});

test('also registers and cleans up with the signal-based WebMCP API', () => {
  const names = new Set<string>();
  setGlobal('navigator', { modelContext: {} });
  setGlobal('document', { modelContext: {
    async registerTool(tool: RegisteredTool, { signal }: { signal: AbortSignal }) {
      names.add(tool.name);
      signal.addEventListener('abort', () => names.delete(tool.name), { once: true });
    }
  } });
  const cleanup = registerWalkthroughTools(options);
  expect([...names].sort()).toEqual(['go_to_step', 'list_steps', 'read_step']);
  cleanup();
  expect([...names]).toEqual([]);
});

test('absent or incomplete WebMCP APIs return safe cleanup functions', () => {
  setGlobal('document', undefined);
  for (const navigator of [undefined, {}, { modelContext: {} }, { modelContext: { registerTool: 'unavailable' } }]) {
    setGlobal('navigator', navigator);
    expect(() => registerWalkthroughTools(options)()).not.toThrow();
  }
});

test('rolls back tools when WebMCP registration throws or rejects', async () => {
  setGlobal('document', undefined);
  for (const rejectAsync of [false, true]) {
    const names = new Set<string>();
    setGlobal('navigator', { modelContext: {
      registerTool(tool: RegisteredTool, { signal }: { signal: AbortSignal }) {
        if (tool.name === 'read_step') {
          const error = new Error('Registration unavailable');
          if (rejectAsync) return Promise.reject(error);
          throw error;
        }
        names.add(tool.name);
        signal.addEventListener('abort', () => names.delete(tool.name), { once: true });
      }
    } });
    const cleanup = registerWalkthroughTools(options);
    await Promise.resolve();
    expect([...names]).toEqual([]);
    expect(cleanup).not.toThrow();
  }
});
