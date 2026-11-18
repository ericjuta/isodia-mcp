import { join } from 'node:path';
import { createApp } from './api';
import { assertSafeToListen, loadConfig } from './config';
import { Store } from './store';

const config = loadConfig(process.env, process.argv.includes('--dev'));
assertSafeToListen(config);
const store = new Store(config.databasePath);
const app = createApp(store, {
  publicUrl: config.publicUrl,
  token: config.token,
  walkthroughsRoot: config.walkthroughsRoot,
  webRoot: join(import.meta.dir, '../../dist')
});

const server = Bun.serve({ hostname: config.host, port: config.port, fetch: app.fetch });
console.log(`isodia listening on ${server.url.origin} (MCP at ${server.url.origin}/mcp)`);
console.log(`browser links: ${config.publicUrl}`);
console.log(`database: ${config.databasePath}${config.token === undefined ? '' : ' | bearer token required'}`);
