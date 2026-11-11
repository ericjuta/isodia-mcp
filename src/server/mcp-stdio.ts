import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config';
import { createMcpServer } from './mcp';
import { Store } from './store';

// stdout carries the protocol; anything for a human goes to stderr.
const config = loadConfig();
const store = new Store(config.databasePath);
await createMcpServer(store, { publicUrl: config.publicUrl }).connect(new StdioServerTransport());
console.error(`isodia MCP server on stdio (database: ${config.databasePath})`);
