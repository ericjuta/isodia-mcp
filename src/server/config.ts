import { join } from 'node:path';

/**
 * Process configuration. The HTTP server and the stdio MCP server read the same values, so by
 * default they open the same database no matter which directory they are started from.
 */
export interface Config {
  port: number;
  /** SQLite file holding every project. */
  databasePath: string;
  /** Where the web app is reachable; used to build editor and share links. */
  publicUrl: string;
  /** When set, the API and the HTTP MCP endpoint require it as a bearer token. */
  token: string | undefined;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const port = Number(env.PORT ?? 4400);
  return {
    port,
    databasePath: env.ISODIA_DB ?? join(import.meta.dir, '../../data/isodia.db'),
    publicUrl: (env.ISODIA_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    token: env.ISODIA_TOKEN || undefined
  };
}
