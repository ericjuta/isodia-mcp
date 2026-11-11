/**
 * Exercise the MCP server over HTTP with a real MCP client, as a remote agent would.
 *
 *   bun scripts/mcp-http-demo.ts [url]
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:4400/mcp');
const client = new Client({ name: 'isodia-http-demo', version: '0.0.0' });
await client.connect(new StreamableHTTPClientTransport(url));

const text = (result: CallToolResult): string => {
  const part = result.content.find((entry) => entry.type === 'text');
  return part?.type === 'text' ? part.text : '';
};

const tools = await client.listTools();
console.log(`tools (${tools.tools.length}):`, tools.tools.map((tool) => tool.name).join(', '));

const created = JSON.parse(
  text((await client.callTool({ name: 'create_project', arguments: { name: 'HTTP transport check' } })) as CallToolResult)
) as { id: string };
console.log('created:', created.id);

const built = (await client.callTool({
  name: 'build_diagram',
  arguments: {
    project: created.id,
    nodes: [
      { id: 'a', name: 'Alpha', icon: 'server' },
      { id: 'b', name: 'Beta', icon: 'storage' }
    ],
    edges: [{ from: 'a', to: 'b', label: 'SQL' }]
  }
})) as CallToolResult;
console.log('build error?', built.isError ?? false, text(built).slice(0, 160));

const picture = (await client.callTool({
  name: 'render_diagram',
  arguments: { project: created.id, width: 600 }
})) as CallToolResult;
const image = picture.content[0];
console.log('image part:', image?.type, image?.type === 'image' ? `${image.data.length} base64 chars` : '');

// A bad tool call must surface as a tool error, not a dropped connection.
const bad = (await client.callTool({
  name: 'edit_diagram',
  arguments: { project: created.id, operations: [{ op: 'connect', from: 'a', to: 'nope' }] }
})) as CallToolResult;
console.log('bad edit is a tool error:', bad.isError === true, '|', text(bad));

const after = JSON.parse(
  text((await client.callTool({ name: 'get_diagram', arguments: { project: created.id } })) as CallToolResult)
) as { items: unknown[] };
console.log('items after failed batch:', after.items.length);

await client.close();
