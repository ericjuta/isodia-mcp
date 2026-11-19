import { join } from 'node:path';
import { svgToPng } from '../core/png';
import { createApp } from './api';
import { assertSafeToListen, loadConfig } from './config';
import { diskWalkthroughs, serveWebApp } from './disk';
import { openSqlite } from './sqlite';
import { Store } from './store';

const config = loadConfig(process.env, process.argv.includes('--dev'));
assertSafeToListen(config);
const store = new Store(openSqlite(config.databasePath));
const webRoot = join(import.meta.dir, '../../dist');
const app = createApp(store, {
  publicUrl: config.publicUrl,
  token: config.token,
  rasterize: svgToPng,
  stdio: { command: 'bun', args: [join(import.meta.dir, 'mcp-stdio.ts')] },
  walkthroughs: diskWalkthroughs(config.walkthroughsRoot, webRoot)
});
serveWebApp(app, webRoot);

const server = Bun.serve({ hostname: config.host, port: config.port, fetch: app.fetch });
console.log(`isodia listening on ${server.url.origin} (MCP at ${server.url.origin}/mcp)`);
console.log(`browser links: ${config.publicUrl}`);
console.log(`database: ${config.databasePath}${config.token === undefined ? '' : ' | bearer token required'}`);
