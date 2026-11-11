import { timingSafeEqual } from 'node:crypto';
import { join, sep } from 'node:path';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import pkg from '../../package.json';
import { ICON_COLLECTIONS, searchIcons, withReferencedIcons } from '../core/icons';
import { applyOperations, buildDiagram, DiagramError, findView } from '../core/model';
import { diagramSpecSchema, operationSchema } from '../core/operations';
import { svgToPng } from '../core/png';
import { renderViewSvg } from '../core/render';
import { ModelValidationError } from '../core/schema';
import type { Model } from '../core/types';
import { createMcpServer } from './mcp';
import { ConflictError, NotFoundError, type Store } from './store';

export interface AppConfig {
  publicUrl: string;
  /** When set, everything except share links requires it as a bearer token. */
  token: string | undefined;
  /** Directory holding the built web app; omitted when only the API is wanted. */
  webRoot?: string;
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
  collection: z.enum(ICON_COLLECTIONS).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

function bearerMatches(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const given = Buffer.from(header ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function renderResponse(model: Model, query: Record<string, string>): Response {
  const { view, format, width } = renderSchema.parse(query);
  const { svg } = renderViewSvg(model, findView(model, view));
  return format === 'svg'
    ? new Response(svg, { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' } })
    : new Response(svgToPng(svg, width), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
}

export function createApp(store: Store, config: AppConfig): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof NotFoundError) return c.json({ error: error.message }, 404);
    if (error instanceof ConflictError) {
      return c.json({ error: error.message, currentRevision: error.currentRevision }, 409);
    }
    if (error instanceof z.ZodError) return c.json({ error: z.prettifyError(error) }, 400);
    if (error instanceof DiagramError || error instanceof ModelValidationError || error instanceof SyntaxError) {
      return c.json({ error: error.message }, 400);
    }
    console.error(error);
    return c.json({ error: 'Internal server error.' }, 500);
  });

  if (config.token !== undefined) {
    const token = config.token;
    const guard: MiddlewareHandler = async (c, next) => {
      if (!bearerMatches(c.req.header('authorization'), token)) {
        return c.json({ error: 'A valid bearer token is required.' }, 401);
      }
      await next();
    };
    for (const path of ['/api/projects', '/api/projects/*', '/api/shares/*', '/api/icons', '/api/info', '/mcp']) {
      app.use(path, guard);
    }
  }

  /** What the web app shows under "Connect an agent". */
  app.get('/api/info', (c) =>
    c.json({
      version: pkg.version,
      mcpUrl: `${config.publicUrl}/mcp`,
      stdioCommand: `bun ${join(import.meta.dir, 'mcp-stdio.ts')}`,
      tokenRequired: config.token !== undefined
    })
  );

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
      // Checked by the store, which validates every model against the editor schema.
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
    const { q, collection, limit } = iconQuerySchema.parse(c.req.query());
    return c.json(searchIcons(q, { collection, limit }));
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
    await createMcpServer(store, { publicUrl: config.publicUrl }).connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  app.on(['GET', 'DELETE'], '/mcp', (c) =>
    c.json({ jsonrpc: '2.0', error: { code: -32000, message: 'This endpoint is stateless; use POST.' }, id: null }, 405)
  );

  app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

  if (config.webRoot !== undefined) {
    const root = config.webRoot;
    // The web app is a single page: real files are served as-is, every other path gets the shell.
    app.get('*', async (c) => {
      const asset = Bun.file(join(root, decodeURIComponent(c.req.path)));
      if (asset.name?.startsWith(root + sep) && (await asset.exists()) && asset.size > 0) {
        return new Response(asset);
      }
      const shell = Bun.file(join(root, 'index.html'));
      if (await shell.exists()) return new Response(shell);
      return c.text('The web app has not been built. Run `bun run build`.', 503);
    });
  }

  return app;
}
