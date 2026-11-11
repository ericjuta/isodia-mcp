/**
 * Drive the stdio MCP server with a real MCP client, exactly as a coding agent would.
 *
 *   bun scripts/mcp-demo.ts [project-name]
 */
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const root = join(import.meta.dir, '..');
const client = new Client({ name: 'isodia-demo', version: '0.0.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [join(root, 'src/server/mcp-stdio.ts')],
    cwd: root,
    env: process.env as Record<string, string>
  })
);

const call = async (name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> => {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = result.content.find((part) => part.type === 'text');
  const body = text?.type === 'text' ? text.text : '';
  console.log(`\n== ${name}${result.isError ? ' (error)' : ''}\n${body.slice(0, 900)}`);
  return result;
};

const parse = (result: CallToolResult): Record<string, unknown> => {
  const text = result.content.find((part) => part.type === 'text');
  return JSON.parse(text?.type === 'text' ? text.text : '{}') as Record<string, unknown>;
};

const name = process.argv[2] ?? 'Payments platform';
const projectId = String(parse(await call('create_project', { name, description: 'Maintained by an agent over MCP.' })).id);

await call('search_icons', { query: 'database', collection: 'aws', limit: 5 });
await call('build_diagram', {
  project: projectId,
  groups: [
    { id: 'edge', name: 'Edge' },
    { id: 'services', name: 'Services' },
    { id: 'data', name: 'Data' }
  ],
  nodes: [
    { id: 'clients', name: 'Mobile clients', icon: 'mobiledevice' },
    { id: 'waf', name: 'WAF', icon: 'firewall', group: 'edge' },
    { id: 'cdn', name: 'CDN', icon: 'cloud', group: 'edge' },
    { id: 'gateway', name: 'API gateway', icon: 'loadbalancer', group: 'services' },
    { id: 'payments', name: 'Payments service', icon: 'server', group: 'services' },
    { id: 'ledger', name: 'Ledger', icon: 'document', group: 'services' },
    { id: 'primary', name: 'Primary database', icon: 'storage', group: 'data' },
    { id: 'replica', name: 'Read replica', icon: 'storage', group: 'data' }
  ],
  edges: [
    { from: 'clients', to: 'waf' },
    { from: 'waf', to: 'cdn', label: 'TLS' },
    { from: 'cdn', to: 'gateway' },
    { from: 'gateway', to: 'payments', label: 'gRPC' },
    { from: 'payments', to: 'ledger' },
    { from: 'payments', to: 'primary', label: 'SQL' },
    { from: 'ledger', to: 'primary' },
    { from: 'primary', to: 'replica', style: 'DASHED' }
  ]
});

await call('edit_diagram', {
  project: projectId,
  operations: [
    { op: 'add_item', name: 'Metrics', icon: 'desktop' },
    { op: 'connect', from: 'payments', to: 'metrics', label: 'traces', style: 'DOTTED' },
    { op: 'add_text', content: 'Production', tile: { x: -14, y: 3 }, fontSize: 0.9 }
  ]
});

await call('render_diagram', { project: projectId, format: 'svg' });
await call('save_checkpoint', { project: projectId, label: 'Demo ready' });
await call('share_project', { project: projectId, action: 'create' });
await call('get_diagram', { project: projectId });

console.log(`\nproject id: ${projectId}`);
await client.close();
