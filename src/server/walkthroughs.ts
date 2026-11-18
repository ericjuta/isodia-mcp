import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { parseWalkthrough, WALKTHROUGH_MAX_BYTES, walkthroughId, type Walkthrough } from '../core/walkthrough';

async function load(root: string | undefined, id: string): Promise<Walkthrough | null> {
  if (!root || !walkthroughId.safeParse(id).success) return null;
  try {
    const file = await open(join(root, `${id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > WALKTHROUGH_MAX_BYTES) return null;
      return parseWalkthrough(JSON.parse(await file.readFile('utf8')));
    } finally {
      await file.close();
    }
  } catch {
    // A missing or invalid file is unavailable; never echo its content or location publicly.
    return null;
  }
}

export function addWalkthroughRoutes(app: Hono, root?: string, webRoot?: string): void {
  app.get('/api/walkthroughs/:id', async (c) => {
    c.header('cache-control', 'no-store');
    const story = await load(root, c.req.param('id'));
    return story ? c.json(story) : c.json({ error: 'Walkthrough not available.' }, 404);
  });

  for (const embed of [false, true]) {
    app.get(embed ? '/w/:id/embed' : '/w/:id', async (c) => {
      c.header('cache-control', 'no-store');
      c.header('referrer-policy', 'no-referrer');
      const story = await load(root, c.req.param('id'));
      const ancestors = embed && story ? new URL(story.articleUrl).origin : "'none'";
      c.header('content-security-policy', `frame-ancestors ${ancestors}`);
      if (!story) return c.text('Walkthrough not available.', 404);
      const shell = webRoot && Bun.file(join(webRoot, 'index.html'));
      if (!shell || !(await shell.exists())) return c.text('The walkthrough web app is unavailable.', 503);
      return c.body(shell.stream(), 200, { 'content-type': 'text/html; charset=utf-8' });
    });
  }
  app.get('/w/*', (c) => c.text('Walkthrough not available.', 404, {
    'cache-control': 'no-store', 'content-security-policy': "frame-ancestors 'none'"
  }));
}
