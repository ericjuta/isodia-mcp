/**
 * Check that the stdio MCP entry point answers an initialize + tools/list handshake, the way an
 * MCP client does when it starts the server from its configuration.
 */
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'registration-check', version: '0.0.0' });
await client.connect(
  new StdioClientTransport({
    command: 'bun',
    args: [join(import.meta.dir, '../src/server/mcp-stdio.ts')]
  })
);

const { tools } = await client.listTools();
const server = client.getServerVersion();
console.log('server:', JSON.stringify(server));
console.log('tools:', tools.length);
console.log('names:', tools.map((tool) => tool.name).join(', '));
const render = tools.find((tool) => tool.name === 'render_diagram');
console.log('render_diagram schema keys:', Object.keys(render?.inputSchema.properties ?? {}));
await client.close();
