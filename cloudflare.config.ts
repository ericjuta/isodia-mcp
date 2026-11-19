import { bindings, defineConfig, exports } from 'cf/config';
import * as entrypoint from './src/worker/index.ts' with { type: 'cf-worker' };
import * as reader from './src/worker/reader.ts' with { type: 'cf-worker' };

/**
 * `--mode askgina-os-walkthrough` builds a separate reader-only Worker for one shareable
 * walkthrough on workers.dev: bundled publications and the web app assets, no Durable Object,
 * secret, editor, API or MCP. Every request runs the Worker first; anything else is 404.
 */
const READER_MODE = 'askgina-os-walkthrough';

/**
 * The Cloudflare target. One Worker serves the built web app as static assets and the published
 * walkthroughs; one SQLite-backed Durable Object holds every project and answers the API and
 * MCP. Build the web app (`bun run build`) before `cf dev`, `cf build` or `cf deploy`: the root
 * `vite.config.ts` ships `dist/` as the assets. See docs/cloudflare.md.
 */
export default defineConfig(({ mode }) => mode === READER_MODE ? {
  worker: {
    name: READER_MODE,
    compatibilityDate: '2026-11-01',
    entrypoint: reader,
    workersDev: true,
    assets: { notFoundHandling: 'none', runWorkerFirst: true },
    env: { ASSETS: bindings.assets() },
    previewUrls: false,
    observability: { enabled: true }
  }
} : {
  worker: {
    name: 'isodia',
    compatibilityDate: '2026-11-01',
    entrypoint,
    assets: {
      notFoundHandling: 'single-page-application',
      // These run the Worker before asset matching. `/w/*` must: a published walkthrough needs
      // its frame policy and an availability check, never a bare copy of the app shell.
      runWorkerFirst: ['/api/*', '/mcp', '/w/*', '/healthz']
    },
    env: {
      ASSETS: bindings.assets(),
      /** Bearer token for the editor, API and MCP. Until it is set they answer 503. */
      ISODIA_TOKEN: bindings.secret()
    },
    exports: {
      Workspace: exports.durableObject({ storage: 'sqlite' })
    },
    // Every Worker version shares the one workspace object. A preview URL would let untested code
    // read and write the live workspace, so versions are only reachable once deployed.
    previewUrls: false,
    observability: { enabled: true }
  }
});
