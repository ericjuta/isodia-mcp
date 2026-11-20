import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig, type Plugin } from 'vite';
import { publications } from '../../vite.config';

function copyReaderPublicAssets(): Plugin {
  const srcDir = resolve(import.meta.dirname, 'public');
  return {
    name: 'isodia:reader-public-assets',
    closeBundle() {
      if (!existsSync(srcDir)) return;
      const outDir = resolve(import.meta.dirname, '.cloudflare/output/v1/workers/default/assets');
      if (!existsSync(outDir)) return;
      mkdirSync(outDir, { recursive: true });
      cpSync(srcDir, outDir, { recursive: true });
    }
  };
}

/** Bundles ./publications into the reader Worker and ships the root dist/ as its assets. */
export default defineConfig(({ isPreview }) => {
  if (!isPreview && !existsSync(new URL('../../dist/index.html', import.meta.url))) {
    throw new Error('dist/index.html is missing. Run `bun run build` at the repository root first.');
  }
  process.env.ISODIA_WALKTHROUGHS_DIR ??= new URL('./publications', import.meta.url).pathname;
  return {
    publicDir: '../../dist',
    plugins: [publications(), cloudflare(), copyReaderPublicAssets()]
  };
});
