import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig, type Plugin } from 'vite';
import { readWalkthroughFile } from './src/server/disk';

/**
 * The Cloudflare build, run by `cf dev`, `cf build` and `cf deploy`. The Bun server and the
 * web app keep their own config in web/vite.config.ts; this one bundles src/worker and ships the
 * web app that `bun run build` wrote to dist/ as the Worker's static assets.
 */

const PUBLICATIONS = 'virtual:isodia/walkthroughs';

/**
 * Bundle the reviewed publications in ISODIA_WALKTHROUGHS_DIR into the Worker, validated by the
 * same code the Bun server reads them with. A file that fails validation fails the build rather
 * than silently disappearing from the published site.
 */
export function publications(): Plugin {
  return {
    name: 'isodia-publications',
    resolveId: (id) => (id === PUBLICATIONS ? `\0${PUBLICATIONS}` : undefined),
    async load(id) {
      if (id !== `\0${PUBLICATIONS}`) return undefined;
      const root = process.env.ISODIA_WALKTHROUGHS_DIR;
      const bundled: Record<string, string> = {};
      if (root) {
        for (const name of (await readdir(root)).filter((entry) => entry.endsWith('.json')).sort()) {
          const slug = name.slice(0, -'.json'.length);
          try {
            bundled[slug] = JSON.stringify(await readWalkthroughFile(root, slug));
          } catch (error) {
            this.error(`Walkthrough publication ${name} in ${root} is not valid: ${error instanceof Error ? error.message : error}`);
          }
        }
        console.log(`Publishing ${Object.keys(bundled).length} walkthrough(s) from ${root}: ${Object.keys(bundled).join(', ') || 'none'}`);
      }
      return `export default ${JSON.stringify(bundled)};`;
    }
  };
}

export default defineConfig(({ isPreview }) => {
  if (!isPreview && !existsSync(new URL('./dist/index.html', import.meta.url))) {
    throw new Error('dist/index.html is missing. Build the web app with `bun run build` before running cf.');
  }
  // Local Durable Object data for `cf dev`, kept under .cloudflare/state unless
  // ISODIA_CLOUDFLARE_STATE names another directory (the runtime check uses a scratch one).
  const state = process.env.ISODIA_CLOUDFLARE_STATE;
  return {
    publicDir: 'dist',
    plugins: [publications(), cloudflare({ persistState: state ? { path: state } : true })]
  };
});
