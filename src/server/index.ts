import { join } from 'node:path';
import { createApp } from './api';
import { assertSafeToListen, loadConfig } from './config';
import { Store } from './store';

const config = loadConfig();
assertSafeToListen(config);
const store = new Store(config.databasePath);
const app = createApp(store, {
  publicUrl: config.publicUrl,
  token: config.token,
  webRoot: join(import.meta.dir, '../../dist')
});

Bun.serve({ hostname: config.host, port: config.port, fetch: app.fetch });
console.log(`isodia listening on ${config.publicUrl} (MCP at ${config.publicUrl}/mcp)`);
console.log(`database: ${config.databasePath}${config.token === undefined ? '' : ' | bearer token required'}`);
