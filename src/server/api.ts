import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import pkg from '../../package.json';
import { searchIcons, withReferencedIcons } from '../core/icons';
import { applyOperations, buildDiagram, DiagramError, findView } from '../core/model';
import { diagramSpecSchema, operationSchema } from '../core/operations';
import { renderViewSvg } from '../core/render';
import { ModelValidationError } from '../core/schema';
import type { Model } from '../core/types';
import { createMcpServer, type Rasterize } from './mcp';
import { StorageLimitError } from './sql';
import { addWalkthroughRoutes, type WalkthroughReader } from './walkthroughs';
import { ConflictError, NotFoundError, type Store } from './store';

/**
 * Everything the HTTP app needs from its host. The shared app holds no runtime-specific code:
 * Bun and the Cloudflare Worker each supply their own rasteriser and publication reader.
 */
export interface AppConfig {
  publicUrl: string;
  /** When set, private APIs and MCP require it as a bearer token. */
  token: string | undefined;
  /**
   * Refuse private APIs and MCP while no token is set, instead of opening them. Set it where
   * every request comes from the network.
   */
  requireToken?: boolean;
  rasterize: Rasterize;
  /** How an agent on this machine starts the stdio MCP server; omitted where none can run. */
  stdio?: { command: string; args: string[] };
  /** Published walkthroughs; omitted where this app does not serve them. */
  walkthroughs?: WalkthroughReader;
}

const createSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  model: z.record(z.string(), z.unknown()).optional()
});
const saveSchema = z.object({ model: z.record(z.string(), z.unknown()), baseRevision: z.number().int() });
const buildSchema = diagramSpecSchema.extend({ view: z.string().optional() });
const operationsSchema = z.object({ view: z.string().optional(), operations: z.array(operationSchema).min(1) });
const renderSchema = z.object({
  view: z.string().optional(),
  format: z.enum(['png', 'svg']).default('png'),
  width: z.coerce.number().int().min(200).max(4000).default(1400)
});
const iconQuerySchema = z.object({
  q: z.string().default(''),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

/**
 * Compare in time that depends only on the lengths, so response timing does not reveal how much
 * of a guess was right.
 */
function bearerMatches(header: string | undefined, token: string): boolean {
  const encoder = new TextEncoder();
  const expected = encoder.encode(`Bearer ${token}`);
  const given = encoder.encode(header ?? '');
  if (given.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ given[index];
  return difference === 0;
}

export function createApp(store: Store, config: AppConfig): Hono {
  const app = new Hono();

  const renderResponse = async (model: Model, query: Record<string, string>): Promise<Response> => {
    const { view, format, width } = renderSchema.parse(query);
    const { svg } = renderViewSvg(model, findView(model, view));
    return format === 'svg'
      ? new Response(svg, { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' } })
      : new Response(await config.rasterize(svg, width), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
  };

  app.onError((error, c) => {
    if (error instanceof NotFoundError) return c.json({ error: error.message }, 404);
    if (error instanceof ConflictError) {
      return c.json({ error: error.message, currentRevision: error.currentRevision }, 409);
    }
    if (error instanceof StorageLimitError) return c.json({ error: error.message }, 413);
    if (error instanceof z.ZodError) return c.json({ error: z.prettifyError(error) }, 400);
    if (error instanceof DiagramError || error instanceof ModelValidationError || error instanceof SyntaxError) {
      return c.json({ error: error.message }, 400);
    }
    console.error(error);
    return c.json({ error: 'Internal server error.' }, 500);
  });

  if (config.token !== undefined || config.requireToken) {
    const token = config.token;
    const guard: MiddlewareHandler = async (c, next) => {
      if (token === undefined) {
        return c.json({ error: 'Private APIs and MCP stay closed until the workspace token (ISODIA_TOKEN) is set.' }, 503);
      }
      if (!bearerMatches(c.req.header('authorization'), token)) {
        return c.json({ error: 'A valid bearer token is required.' }, 401);
      }
      await next();
    };
    for (const path of ['/api/projects', '/api/projects/*', '/api/shares/*', '/api/icons', '/api/info', '/mcp']) {
      app.use(path, guard);
    }
  }

  /** Liveness only, so a container health check needs no token. */
  app.get('/healthz', (c) => c.text('ok'));

  /** What the web app shows under "Connect an agent". */
  app.get('/api/info', (c) => {
    const { stdio } = config;
    return c.json({
      version: pkg.version,
      mcpUrl: `${config.publicUrl}/mcp`,
      ...(stdio && {
        stdioCommand: [stdio.command, ...stdio.args].join(' '),
        stdio: { ...stdio, env: { ISODIA_URL: config.publicUrl } }
      }),
      tokenRequired: config.token !== undefined
    });
  });

  app.get('/api/projects', (c) => c.json(store.listProjects()));

  app.post('/api/projects', async (c) => {
    const body = createSchema.parse(await c.req.json());
    const project = body.model
      ? store.importProject(body.model, body.name)
      : store.createProject({ name: body.name ?? 'Untitled', description: body.description }, 'api');
    return c.json(project, 201);
  });

  app.get('/api/projects/:id', (c) => c.json(store.getProject(c.req.param('id'))));

  /** Cheap enough to poll: lets an open editor notice edits made elsewhere. */
  app.get('/api/projects/:id/revision', (c) => c.json({ revision: store.getProject(c.req.param('id')).revision }));

  app.delete('/api/projects/:id', (c) => {
    store.deleteProject(c.req.param('id'));
    return c.body(null, 204);
  });

  app.put('/api/projects/:id/model', async (c) => {
    const { model, baseRevision } = saveSchema.parse(await c.req.json());
    const saved = store.updateModel(
      c.req.param('id'),
      { source: 'editor', summary: 'Edited in the editor', expectedRevision: baseRevision },
      // Checked by the store, which validates every model against the model schema.
      () => model as unknown as Model
    );
    return c.json({ revision: saved.revision, updatedAt: saved.updatedAt });
  });

  app.post('/api/projects/:id/build', async (c) => {
    const { view, ...spec } = buildSchema.parse(await c.req.json());
    const saved = store.updateModel(
      c.req.param('id'),
      { source: 'api', summary: `Built diagram: ${spec.nodes.length} nodes, ${spec.edges.length} edges` },
      (model) => buildDiagram(model, view, spec).model
    );
    return c.json(saved);
  });

  app.post('/api/projects/:id/operations', async (c) => {
    const { view, operations } = operationsSchema.parse(await c.req.json());
    let results: string[] = [];
    const kinds = [...new Set(operations.map((operation) => operation.op))].join(', ');
    const saved = store.updateModel(
      c.req.param('id'),
      { source: 'api', summary: `Edited diagram: ${kinds}` },
      (model) => {
        const applied = applyOperations(model, view, operations);
        results = applied.results;
        return applied.model;
      }
    );
    return c.json({ results, revision: saved.revision });
  });

  app.get('/api/projects/:id/render', (c) => renderResponse(store.getProject(c.req.param('id')).model, c.req.query()));

  app.get('/api/projects/:id/export', (c) => {
    const project = store.getProject(c.req.param('id'));
    c.header('content-disposition', `attachment; filename="${project.id}.json"`);
    return c.json(withReferencedIcons(project.model));
  });

  app.get('/api/projects/:id/revisions', (c) => c.json(store.listRevisions(c.req.param('id'))));

  app.get('/api/projects/:id/revisions/:number/render', (c) =>
    renderResponse(store.getRevisionModel(c.req.param('id'), Number(c.req.param('number'))), c.req.query())
  );

  app.post('/api/projects/:id/revisions/:number/restore', (c) => {
    const restored = store.restoreRevision(c.req.param('id'), Number(c.req.param('number')));
    return c.json(restored);
  });

  app.post('/api/projects/:id/checkpoints', async (c) => {
    const { label } = z.object({ label: z.string().min(1).max(100) }).parse(await c.req.json());
    return c.json(store.labelCurrentRevision(c.req.param('id'), label), 201);
  });

  app.get('/api/projects/:id/shares', (c) => c.json(store.listShareLinks(c.req.param('id'))));

  app.post('/api/projects/:id/shares', async (c) => {
    const { view } = z.object({ view: z.string().optional() }).parse(await c.req.json());
    return c.json(store.createShareLink(c.req.param('id'), view), 201);
  });

  app.delete('/api/shares/:token', (c) => {
    store.revokeShareLink(c.req.param('token'));
    return c.body(null, 204);
  });

  app.get('/api/icons', (c) => {
    const { q, limit } = iconQuerySchema.parse(c.req.query());
    return c.json(searchIcons(q, { limit }));
  });

  // Share links are the credential: these routes are deliberately outside the token guard.
  app.get('/api/shared/:token', (c) => {
    const { project, viewId } = store.resolveShareLink(c.req.param('token'));
    return c.json({ name: project.name, revision: project.revision, viewId, model: project.model });
  });

  app.get('/api/shared/:token/revision', (c) =>
    c.json({ revision: store.resolveShareLink(c.req.param('token')).project.revision })
  );

  // Stateless MCP over streamable HTTP: each POST is a complete exchange with its own server.
  app.post('/mcp', async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    await createMcpServer(store, { publicUrl: config.publicUrl, rasterize: config.rasterize }).connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  app.on(['GET', 'DELETE'], '/mcp', (c) =>
    c.json({ jsonrpc: '2.0', error: { code: -32000, message: 'This endpoint is stateless; use POST.' }, id: null }, 405)
  );

  addWalkthroughRoutes(app, config.walkthroughs);

  app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

  return app;
}
