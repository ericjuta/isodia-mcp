/**
 * Shared driver for the worked examples: build a set of views through the MCP server, then write
 * each view as SVG and PNG plus the model JSON (Isoflow format) the editor can open directly.
 *
 * Every view is built through the MCP server rather than the REST API, so a run also exercises
 * `build_diagram`, `manage_views`, `export_project` and `render_diagram` on a real workload.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface Spec {
  view: string;
  groups: { id: string; name: string; color?: string }[];
  nodes: { id: string; name: string; icon?: string; group?: string; description?: string }[];
  edges: { from: string; to: string; label?: string; style?: string; color?: string }[];
}

export interface Documentation {
  /** Project name; a rerun replaces every project with this name. */
  name: string;
  description: string;
  /** Base name of the exported model: `<file>.isoflow.json`. */
  file: string;
  views: Spec[];
}

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

/** File name of a view: "Message path" becomes "message-path". */
export function slug(view: string): string {
  return view
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Reads `--url` and `--out`, builds every view and writes the files into `--out`.
 * `--png-only` skips the SVGs: they embed the icon artwork, so they are large and do not diff.
 */
export async function document(docs: Documentation): Promise<void> {
  const url = argument('url', 'http://127.0.0.1:4400');
  const out = argument('out', 'docs/diagrams');
  const pngOnly = process.argv.includes('--png-only');

  const client = new Client({ name: 'isodia-example', version: '0.0.1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));

  async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    const first = (result.content as { type: string; text?: string }[])[0];
    if (result.isError) throw new Error(`${name}: ${first?.text ?? 'unknown error'}`);
    return first.text as T;
  }

  /** PNG renders arrive as an image content block, not as text. */
  async function pngBytes(project: string, view: string): Promise<Buffer> {
    const result = await client.callTool({
      name: 'render_diagram',
      arguments: { project, view, format: 'png', width: 1600 }
    });
    const parts = result.content as { type: string; data?: string; text?: string }[];
    if (result.isError) throw new Error(`render_diagram: ${parts[0]?.text ?? 'unknown error'}`);
    const image = parts.find((part) => part.type === 'image' && part.data);
    if (image?.data === undefined) throw new Error(`render_diagram: no image for ${view}`);
    return Buffer.from(image.data, 'base64');
  }

  const existing = JSON.parse(await call<string>('list_projects', {})) as { id: string; name: string }[];
  for (const prior of existing.filter((entry) => entry.name === docs.name)) {
    await call('delete_project', { project: prior.id });
  }

  const created = JSON.parse(
    await call<string>('create_project', { name: docs.name, description: docs.description })
  ) as { id: string };
  const project = created.id;

  // A new project starts with one view named "Overview"; give it the first view's name.
  await call('manage_views', { project, action: 'update', view: 'Overview', name: docs.views[0].view });
  for (const spec of docs.views.slice(1)) await call('manage_views', { project, action: 'create', name: spec.view });

  for (const spec of docs.views) {
    // A project has one item list shared by all views, and a node id names an item. Each view
    // here describes its own items, so scope the ids: otherwise the last view to reuse an id
    // ("hub", "app") renames and re-icons that item in every earlier view.
    const scoped = (id: string): string => `${slug(spec.view)}-${id}`;
    const built = JSON.parse(
      await call<string>('build_diagram', {
        project,
        view: spec.view,
        groups: spec.groups,
        nodes: spec.nodes.map((node) => ({ ...node, id: scoped(node.id) })),
        edges: spec.edges.map((edge) => ({ ...edge, from: scoped(edge.from), to: scoped(edge.to) }))
      })
    ) as { revision: number; items: unknown[]; connectors: string[]; regions: unknown[] };
    console.log(
      `${spec.view}: ${built.items.length} items, ${built.connectors.length} connectors, ${built.regions.length} regions, revision ${built.revision}`
    );
  }

  await call('save_checkpoint', { project, label: 'documented' });

  const model = await call<string>('export_project', { project, standalone: false });
  await mkdir(out, { recursive: true });
  await Bun.write(join(out, `${docs.file}.isoflow.json`), `${JSON.stringify(JSON.parse(model), null, 2)}\n`);

  for (const spec of docs.views) {
    if (!pngOnly) {
      const svg = await call<string>('render_diagram', { project, view: spec.view, format: 'svg' });
      if (!svg.startsWith('<svg')) throw new Error(`${spec.view}: ${svg}`);
      const svgFile = join(out, `${slug(spec.view)}.svg`);
      await Bun.write(svgFile, svg);
      console.log(`${svgFile} ${svg.length} bytes`);
    }

    // Preview raster for chat and issue links, which do not render SVG from a blob URL.
    const png = await pngBytes(project, spec.view);
    const pngFile = join(out, `${slug(spec.view)}.png`);
    await Bun.write(pngFile, png);
    console.log(`${pngFile} ${png.byteLength} bytes`);
  }

  await client.close();
  console.log('project', project);
}
