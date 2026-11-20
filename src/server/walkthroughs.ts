import type { Hono } from 'hono';
import type { Walkthrough } from '../core/walkthrough';
import { enhanceWalkthroughHtml, prefersMarkdown, walkthroughMarkdown } from './walkthrough-seo';

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
  ogImageForId: (id: string) => string | undefined = () => undefined,
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
      const rawId = c.req.param('id');
      const isMd = !embed && rawId.endsWith('.md');
      const id = isMd ? rawId.slice(0, -3) : rawId;
      const story = reader ? await reader.load(id) : null;
      const ancestors = embed && story
        ? [new URL(story.articleUrl).origin, ...extraFrameOrigins(id)].join(' ')
        : "'none'";
      c.header('content-security-policy', `frame-ancestors ${ancestors}`);
      if (!story || !reader) return c.text('Walkthrough not available.', 404);
      const origin = new URL(c.req.url).origin;
      const seo = { origin, id, ogImagePath: ogImageForId(id) };
      if (isMd) {
        const md = walkthroughMarkdown(story, seo);
        return c.text(md, 200, { 'content-type': 'text/markdown; charset=utf-8' });
      }
      if (!embed) {
        c.header('vary', 'Accept, User-Agent');
        c.header(
          'link',
          [
            `<${origin}/w/${id}>; rel="canonical"`,
            `<${origin}/w/${id}.md>; rel="alternate"; type="text/markdown"`,
            `<${origin}/.well-known/api-catalog>; rel="api-catalog"`,
            `<${origin}/.well-known/ard.json>; rel="ard"`
          ].join(', '),
        );
        if (prefersMarkdown(c.req.raw)) {
          const md = walkthroughMarkdown(story, seo);
          return c.text(md, 200, { 'content-type': 'text/markdown; charset=utf-8' });
        }
      }
      const shell = await reader.shell(c.req.raw);
      if (!shell) return c.text('The walkthrough web app is unavailable.', 503);
      if (embed) {
        return c.body(shell, 200, { 'content-type': 'text/html; charset=utf-8' });
      }
      const rawHtml = await new Response(shell).text();
      const html = enhanceWalkthroughHtml(rawHtml, story, seo);
      return c.body(html, 200, { 'content-type': 'text/html; charset=utf-8' });
    });
  }
  app.get('/w/*', (c) => c.text('Walkthrough not available.', 404, {
    'cache-control': 'no-store', 'content-security-policy': "frame-ancestors 'none'"
  }));
}
