import { join } from 'node:path';

/**
 * Process configuration. The HTTP server and the stdio MCP server read the same values, so by
 * default they open the same database no matter which directory they are started from.
 */
export interface Config {
  /** Interface the HTTP server listens on. */
  host: string;
  port: number;
  /** SQLite file holding every project. */
  databasePath: string;
  /** Where the web app is reachable; used to build editor and share links. */
  publicUrl: string;
  /** When set, the API and the HTTP MCP endpoint require it as a bearer token. */
  token: string | undefined;
  /** Optional directory of operator-published walkthrough snapshots. */
  walkthroughsRoot?: string;
}

export function apiPort(env: NodeJS.ProcessEnv): number {
  return Number(env.PORT ?? 4400);
}

export function devWebPort(env: NodeJS.ProcessEnv): number {
  return Number(env.ISODIA_WEB_PORT ?? 4401);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, development = false): Config {
  const port = apiPort(env);
  const webPort = development ? devWebPort(env) : port;
  return {
    host: env.HOST || '127.0.0.1',
    port,
    databasePath: env.ISODIA_DB ?? join(import.meta.dir, '../../data/isodia.db'),
    publicUrl: (env.ISODIA_URL ?? `http://localhost:${webPort}`).replace(/\/+$/, ''),
    token: env.ISODIA_TOKEN || undefined,
    walkthroughsRoot: env.ISODIA_WALKTHROUGHS_DIR || undefined
  };
}

const LOOPBACK: Record<string, true> = { '127.0.0.1': true, '::1': true, localhost: true };

/**
 * Refuse to serve beyond this machine without a token: with none set, anyone who can reach the
 * port can read, change and delete every project.
 */
export function assertSafeToListen(config: Pick<Config, 'host' | 'token'>): void {
  if (config.token === undefined && !LOOPBACK[config.host]) {
    throw new Error(`HOST=${config.host} is reachable from other machines; set ISODIA_TOKEN, or leave HOST unset to serve this machine only.`);
  }
}
