import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { Hono } from 'hono';
import { parseWalkthrough, WALKTHROUGH_MAX_BYTES, walkthroughId, type Walkthrough } from '../core/walkthrough';
import type { WalkthroughReader } from './walkthroughs';

/**
 * Read and validate the publication `<root>/<id>.json`. Refuses symbolic links, anything that is
 * not a regular file, oversized files and files that fail validation, saying which.
 */
export async function readWalkthroughFile(root: string, id: string): Promise<Walkthrough> {
  walkthroughId.parse(id);
  const file = await open(join(root, `${id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error(`${id}.json is not a regular file.`);
    if (stat.size > WALKTHROUGH_MAX_BYTES) throw new Error(`${id}.json is larger than ${WALKTHROUGH_MAX_BYTES} bytes.`);
    return parseWalkthrough(JSON.parse(await file.readFile('utf8')));
  } finally {
    await file.close();
  }
}

/** Publications as reviewed files in `root` (none when unset), read on every request. */
export function diskWalkthroughs(root: string | undefined, webRoot: string): WalkthroughReader {
  return {
    async load(id) {
      if (!root) return null;
      try {
        return await readWalkthroughFile(root, id);
      } catch {
        // A missing or invalid file is unavailable; never echo its content or location publicly.
        return null;
      }
    },
    async shell() {
      const file = Bun.file(join(webRoot, 'index.html'));
      return (await file.exists()) ? file.stream() : null;
    }
  };
}

/** Serve the built single-page app: real files as-is, every other path gets the shell. */
export function serveWebApp(app: Hono, root: string): void {
  app.get('*', async (c) => {
    const asset = Bun.file(join(root, decodeURIComponent(c.req.path)));
    if (asset.name?.startsWith(root + sep) && (await asset.exists()) && asset.size > 0) {
      return new Response(asset);
    }
    const shell = Bun.file(join(root, 'index.html'));
    if (await shell.exists()) return new Response(shell);
    return c.text('No built web app on this port. For local development, run `bun run dev:web` and open its address. For a single-server deployment, build the web app first.', 503);
  });
}
