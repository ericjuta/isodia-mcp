import { Hono } from 'hono';
import publications from 'virtual:isodia/walkthroughs';
import { addWalkthroughRoutes } from '../server/walkthroughs';
import { bundledWalkthroughs } from './walkthroughs';

interface ReaderEnv {
  ASSETS: Fetcher;
}

/**
 * A reader-only Worker: the published walkthroughs bundled at build time and the web app files
 * they need. No workspace, editor, API, MCP or secret. Every request runs here first, so any
 * path that is not a bundled walkthrough or a built asset is 404.
 */
export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/assets/')) return env.ASSETS.fetch(request);
    const slugs = Object.keys(publications);
    if (pathname === '/' && slugs.length === 1) {
      return Response.redirect(new URL(`/w/${slugs[0]}`, request.url).toString(), 302);
    }
    if (pathname.startsWith('/w/') || pathname.startsWith('/api/walkthroughs/')) {
      const reader = new Hono();
      addWalkthroughRoutes(reader, bundledWalkthroughs(env.ASSETS));
      return reader.fetch(request);
    }
    return new Response('Not found.', { status: 404, headers: { 'cache-control': 'no-store' } });
  }
} satisfies ExportedHandler<ReaderEnv>;
