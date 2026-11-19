import type { Hono } from 'hono';
import type { Walkthrough } from '../core/walkthrough';

/** Where this host keeps reviewed walkthrough publications and the web app that reads them. */
export interface WalkthroughReader {
  /** A validated publication, or null when it is missing or invalid. Never throws. */
  load(id: string): Promise<Walkthrough | null>;
  /** The built web app's HTML shell, or null when this host has none. */
  shell(request: Request): Promise<ReadableStream | null>;
}

/**
 * Public, read-only routes for published walkthroughs. A missing or invalid publication is
 * unavailable; its content or location is never echoed.
 */
export function addWalkthroughRoutes(
  app: Hono,
  reader: WalkthroughReader | undefined,
  // Deployment-controlled exact HTTPS origins, never derived from the request.
  extraFrameOrigins: (id: string) => readonly string[] = () => [],
): void {
  app.get('/api/walkthroughs/:id', async (c) => {
    c.header('cache-control', 'no-store');
    const story = reader ? await reader.load(c.req.param('id')) : null;
    return story ? c.json(story) : c.json({ error: 'Walkthrough not available.' }, 404);
  });

  for (const embed of [false, true]) {
    app.get(embed ? '/w/:id/embed' : '/w/:id', async (c) => {
      c.header('cache-control', 'no-store');
      c.header('referrer-policy', 'no-referrer');
      const id = c.req.param('id');
      const story = reader ? await reader.load(id) : null;
      const ancestors = embed && story
        ? [new URL(story.articleUrl).origin, ...extraFrameOrigins(id)].join(' ')
        : "'none'";
      c.header('content-security-policy', `frame-ancestors ${ancestors}`);
      if (!story || !reader) return c.text('Walkthrough not available.', 404);
      const shell = await reader.shell(c.req.raw);
      if (!shell) return c.text('The walkthrough web app is unavailable.', 503);
      return c.body(shell, 200, { 'content-type': 'text/html; charset=utf-8' });
    });
  }
  app.get('/w/*', (c) => c.text('Walkthrough not available.', 404, {
    'cache-control': 'no-store', 'content-security-policy': "frame-ancestors 'none'"
  }));
}
