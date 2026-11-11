import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import pkg from '../../package.json';
import { describeView } from '../core/describe';
import { ICON_COLLECTIONS, searchIcons, withReferencedIcons } from '../core/icons';
import { applyOperations, buildDiagram, createView, deleteView, findView, updateView } from '../core/model';
import { diagramSpecSchema, operationSchema } from '../core/operations';
import { svgToPng } from '../core/png';
import { renderViewSvg } from '../core/render';
import type { Store } from './store';

const INSTRUCTIONS = `Isometric architecture and network diagrams in the Isoflow format.
A project holds a shared set of items plus one or more views that place those items on a tile grid, so one model can back several diagrams.

Typical flow: list_projects or create_project, then build_diagram to lay out a whole graph automatically, edit_diagram for targeted changes, and render_diagram to look at the result.

Icons: the "isoflow" collection is 3D isometric artwork (server, storage, cloud, user, ...); aws, azure, gcp and kubernetes are flat vendor icons. Find ids with search_icons.
Tiles are integer {x, y}. In the picture +x runs toward the upper right and +y toward the upper left; keep items about 3 tiles apart.
Every change is recorded as a revision, so restore_revision undoes a mistake. Only the newest 100 revisions are kept, plus the original and any checkpoint you name with save_checkpoint.`;

const text = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
});

const project = z.string().describe('Project id, as returned by list_projects.');
const view = z.string().optional().describe('View id or name. Defaults to the first view.');

/** Register the diagram tools against `store`. `publicUrl` is where the web app is reachable. */
export function createMcpServer(store: Store, options: { publicUrl: string }): McpServer {
  const server = new McpServer({ name: 'isodia', version: pkg.version }, { instructions: INSTRUCTIONS });
  const editorUrl = (projectId: string, viewId?: string): string =>
    `${options.publicUrl}/p/${projectId}${viewId === undefined ? '' : `?view=${encodeURIComponent(viewId)}`}`;
  const shareUrl = (token: string): string => `${options.publicUrl}/s/${token}`;

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'List every diagram project with its id, name and current revision.',
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    () => text(store.listProjects().map((entry) => ({ ...entry, url: editorUrl(entry.id) })))
  );

  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description: 'Create an empty project with one view named "Overview". Returns the project id.',
      inputSchema: { name: z.string().min(1).max(100), description: z.string().max(1000).optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
    },
    ({ name, description }) => {
      const created = store.createProject({ name, description }, 'mcp');
      return text({
        id: created.id,
        name: created.name,
        views: created.model.views.map((entry) => entry.id),
        url: editorUrl(created.id)
      });
    }
  );

  server.registerTool(
    'delete_project',
    {
      title: 'Delete project',
      description: 'Permanently delete a project with its history and share links.',
      inputSchema: { project },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    },
    ({ project: projectId }) => {
      store.deleteProject(projectId);
      return text(`Deleted project "${projectId}".`);
    }
  );

  server.registerTool(
    'get_diagram',
    {
      title: 'Read diagram',
      description:
        'Read one view as structured data: items with tiles and icons, connectors, regions and text, plus the list of views in the project.',
      inputSchema: { project, view },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    ({ project: projectId, view: viewRef }) => {
      const current = store.getProject(projectId);
      const target = findView(current.model, viewRef);
      return text({
        ...describeView(current.model, target),
        revision: current.revision,
        url: editorUrl(projectId, target.id)
      });
    }
  );

  server.registerTool(
    'search_icons',
    {
      title: 'Search icons',
      description:
        'Find icon ids by keyword. The "isoflow" collection (37 isometric icons such as server, storage, cloud, user, loadbalancer, queue, firewall) suits generic architecture; aws, azure, gcp and kubernetes hold flat vendor icons. An empty query lists a collection.',
      inputSchema: {
        query: z.string().describe('Keywords, e.g. "load balancer" or "s3".'),
        collection: z.enum(ICON_COLLECTIONS).optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Defaults to 20.')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    ({ query, collection, limit }) => text(searchIcons(query, { collection, limit }))
  );

  server.registerTool(
    'build_diagram',
    {
      title: 'Build diagram',
      description:
        'Replace a view with a graph described as nodes, edges and groups, laid out automatically: edges flow from the upper left to the lower right and each group becomes a titled, coloured region. Node ids become item ids, so calling this again with an edited spec updates the same items. Use edit_diagram instead for small changes to an existing layout.',
      inputSchema: { project, view, ...diagramSpecSchema.shape },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    },
    ({ project: projectId, view: viewRef, ...spec }) => {
      let viewId = '';
      const saved = store.updateModel(
        projectId,
        { source: 'mcp', summary: `Built diagram: ${spec.nodes.length} nodes, ${spec.edges.length} edges` },
        (model) => {
          const built = buildDiagram(model, viewRef, spec);
          viewId = built.viewId;
          return built.model;
        }
      );
      const built = describeView(saved.model, findView(saved.model, viewId));
      return text({
        view: built.view,
        items: built.items.map((item) => ({ id: item.id, tile: item.tile })),
        connectors: built.connectors.map((connector) => connector.id),
        regions: built.regions.map((region) => ({ id: region.id, from: region.from, to: region.to })),
        revision: saved.revision,
        url: editorUrl(projectId, viewId)
      });
    }
  );

  server.registerTool(
    'edit_diagram',
    {
      title: 'Edit diagram',
      description:
        'Apply a batch of edits to one view: add, place, update, move or remove items; connect them; add regions and text; or re-run auto_layout. The batch is atomic: if any operation fails nothing is saved and the error names the failing operation.',
      inputSchema: { project, view, operations: z.array(operationSchema).min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
    },
    ({ project: projectId, view: viewRef, operations }) => {
      let results: string[] = [];
      const kinds = [...new Set(operations.map((operation) => operation.op))].join(', ');
      const saved = store.updateModel(projectId, { source: 'mcp', summary: `Edited diagram: ${kinds}` }, (model) => {
        const applied = applyOperations(model, viewRef, operations);
        results = applied.results;
        return applied.model;
      });
      return text({ results, revision: saved.revision });
    }
  );

  server.registerTool(
    'render_diagram',
    {
      title: 'Render diagram',
      description:
        'Render a view as an image so you can check the layout. PNG is returned as an image; SVG as text.',
      inputSchema: {
        project,
        view,
        format: z.enum(['png', 'svg']).optional().describe('Defaults to png.'),
        width: z.number().int().min(200).max(4000).optional().describe('PNG width in pixels. Defaults to 1400.')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    ({ project: projectId, view: viewRef, format, width }) => {
      const current = store.getProject(projectId);
      const target = findView(current.model, viewRef);
      const rendered = renderViewSvg(current.model, target);
      if (format === 'svg') return text(rendered.svg);
      const png = svgToPng(rendered.svg, width ?? 1400);
      return {
        content: [
          { type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' },
          { type: 'text', text: `View "${target.name}" of project "${current.name}" at revision ${current.revision}.` }
        ]
      };
    }
  );

  server.registerTool(
    'manage_views',
    {
      title: 'Manage views',
      description:
        'Create, rename or delete a view. Views share the project\'s items, so a new view can show the same systems for a different audience; use copyFrom to start from an existing view.',
      inputSchema: {
        project,
        action: z.enum(['create', 'update', 'delete']),
        view: z.string().optional().describe('Target view for update and delete.'),
        name: z.string().min(1).max(100).optional().describe('Required for create; the new name for update.'),
        description: z.string().max(1000).optional(),
        copyFrom: z.string().optional().describe('For create: view to duplicate.')
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
    },
    ({ project: projectId, action, view: viewRef, name, description, copyFrom }) => {
      const saved = store.updateModel(projectId, { source: 'mcp', summary: `View ${action}` }, (model) => {
        if (action === 'create') {
          if (name === undefined) throw new Error('`name` is required to create a view.');
          return createView(model, { name, description, copyFrom }).model;
        }
        if (viewRef === undefined) throw new Error(`\`view\` is required to ${action} a view.`);
        return action === 'delete' ? deleteView(model, viewRef) : updateView(model, viewRef, { name, description });
      });
      return text({
        views: saved.model.views.map((entry) => ({ id: entry.id, name: entry.name, items: entry.items.length })),
        revision: saved.revision
      });
    }
  );

  server.registerTool(
    'list_revisions',
    {
      title: 'List revisions',
      description: 'List a project\'s saved revisions, newest first, with what made each one.',
      inputSchema: { project },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    ({ project: projectId }) => text(store.listRevisions(projectId))
  );

  server.registerTool(
    'restore_revision',
    {
      title: 'Restore revision',
      description:
        'Make an earlier revision current again. The restore is itself a new revision, so the restored-to revision and everything after it stay available. Only the newest 100 revisions are kept, plus the original and any named checkpoint, so restore an old number before it is pruned.',
      inputSchema: { project, revision: z.number().int().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
    },
    ({ project: projectId, revision }) => {
      const saved = store.restoreRevision(projectId, revision);
      return text({ restored: revision, revision: saved.revision });
    }
  );

  server.registerTool(
    'save_checkpoint',
    {
      title: 'Save checkpoint',
      description: 'Name the current revision so it is easy to find and restore later.',
      inputSchema: { project, label: z.string().min(1).max(100) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    ({ project: projectId, label }) => text(store.labelCurrentRevision(projectId, label))
  );

  server.registerTool(
    'share_project',
    {
      title: 'Share project',
      description:
        'Manage read-only share links. Anyone holding a link can view the live diagram without signing in; revoke removes that access.',
      inputSchema: {
        project,
        action: z.enum(['create', 'list', 'revoke']),
        view: z.string().optional().describe('For create: the view the link opens on.'),
        token: z.string().optional().describe('For revoke: the token of the link to remove.')
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
    },
    ({ project: projectId, action, view: viewRef, token }) => {
      if (action === 'create') {
        const link = store.createShareLink(projectId, viewRef);
        return text({ token: link.token, url: shareUrl(link.token), view: link.viewId });
      }
      if (action === 'revoke') {
        if (token === undefined) throw new Error('`token` is required to revoke a share link.');
        const owned = store.listShareLinks(projectId).some((link) => link.token === token);
        if (!owned) throw new Error(`Project "${projectId}" has no share link with that token.`);
        store.revokeShareLink(token);
      }
      return text(
        store.listShareLinks(projectId).map((link) => ({
          token: link.token,
          url: shareUrl(link.token),
          view: link.viewId,
          createdAt: link.createdAt
        }))
      );
    }
  );

  server.registerTool(
    'export_project',
    {
      title: 'Export project',
      description:
        'Return the project as Isoflow model JSON. With standalone=true the icons its items use are embedded, giving a file the open-source Isoflow editor opens directly; that output is much larger.',
      inputSchema: { project, standalone: z.boolean().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    ({ project: projectId, standalone }) => {
      const { model } = store.getProject(projectId);
      return text(standalone ? withReferencedIcons(model) : model);
    }
  );

  server.registerTool(
    'import_project',
    {
      title: 'Import project',
      description:
        'Create a project from Isoflow model JSON (title, items, views, and optionally colors and icons). Icons from the bundled catalog do not need to be included.',
      inputSchema: {
        name: z.string().min(1).max(100).optional().describe('Defaults to the model title.'),
        model: z.record(z.string(), z.unknown())
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
    },
    ({ name, model }) => {
      const created = store.importProject(model, name);
      return text({
        id: created.id,
        name: created.name,
        views: created.model.views.map((entry) => entry.id),
        url: editorUrl(created.id)
      });
    }
  );

  return server;
}
