import { existsSync } from 'node:fs';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';
import { publications } from '../../vite.config';

/** Bundles ./publications into the reader Worker and ships the root dist/ as its assets. */
export default defineConfig(({ isPreview }) => {
  if (!isPreview && !existsSync(new URL('../../dist/index.html', import.meta.url))) {
    throw new Error('dist/index.html is missing. Run `bun run build` at the repository root first.');
  }
  process.env.ISODIA_WALKTHROUGHS_DIR ??= new URL('./publications', import.meta.url).pathname;
  return {
    publicDir: '../../dist',
    plugins: [publications(), cloudflare()]
  };
});
