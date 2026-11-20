import { bindings, defineConfig } from 'cf/config';
import * as entrypoint from '../../src/worker/reader.ts' with { type: 'cf-worker' };

/**
 * A reader-only Worker for the reviewed Ask Gina OS walkthrough on workers.dev: the publication
 * in ./publications and the web app assets from ../../dist. No Durable Object, secret, editor,
 * API or MCP. Every request runs the Worker first; anything else is 404. Run cf from this
 * directory after `bun run build` at the repository root.
 */
export default defineConfig({
  worker: {
    name: 'askgina-os-walkthrough',
    compatibilityDate: '2026-11-01',
    entrypoint,
    workersDev: true,
    assets: { notFoundHandling: 'none', runWorkerFirst: true },
    env: { ASSETS: bindings.assets() },
    previewUrls: false,
    observability: { enabled: true }
  }
});
