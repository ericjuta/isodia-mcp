import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import { createApp } from '../server/api';
import { Store } from '../server/store';
import { addWalkthroughRoutes } from '../server/walkthroughs';
import { svgToPng } from './png';
import { durableObjectSql } from './sql';
import { bundledWalkthroughs } from './walkthroughs';

/**
 * The workspace: every project, revision and share link, in one SQLite-backed Durable Object.
 * The API and MCP run inside it, so each store call is a synchronous transaction on its own
 * storage and concurrent editors keep the same optimistic-revision rules as on Bun.
 */
export class Workspace extends DurableObject<Env> {
  private readonly store = new Store(durableObjectSql(this.ctx.storage));
  /** Links point at the address a request arrived on: workers.dev or a custom domain. */
  private readonly apps = new Map<string, Hono>();

  override fetch(request: Request): Promise<Response> | Response {
    const origin = new URL(request.url).origin;
    let app = this.apps.get(origin);
    if (app === undefined) {
      app = createApp(this.store, {
        publicUrl: origin,
        token: this.env.ISODIA_TOKEN || undefined,
        // Every request reaches a Worker over the network; never open the workspace without a token.
        requireToken: true,
        rasterize: svgToPng
      });
      this.apps.set(origin, app);
    }
    return app.fetch(request);
  }
}

export default {
  fetch(request, env, ctx) {
    // The asset router answers the web app's files itself and passes on only the paths listed
    // in cloudflare.config.ts. Published walkthroughs are answered here, so article readers never
    // queue behind editors on the single workspace object; everything else goes to it.
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/w/') || pathname.startsWith('/api/walkthroughs/')) {
      const reader = new Hono();
      addWalkthroughRoutes(reader, bundledWalkthroughs(env.ASSETS));
      return reader.fetch(request);
    }
    return ctx.exports.Workspace.getByName('workspace').fetch(request);
  }
} satisfies ExportedHandler<Env>;
