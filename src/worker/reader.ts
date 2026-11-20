import { Hono } from 'hono';
import publications from 'virtual:isodia/walkthroughs';
import type { Walkthrough } from '../core/walkthrough';
import { addWalkthroughRoutes } from '../server/walkthroughs';
import { prefersMarkdown, walkthroughDescription, walkthroughMarkdown } from '../server/walkthrough-seo';
import { bundledWalkthroughs } from './walkthroughs';

interface ReaderEnv {
  ASSETS: Fetcher;
}

const ASKGINA_OS_ID = 'askgina-os-v1';
const OG_IMAGES: Record<string, string> = {
  [ASKGINA_OS_ID]: '/og-askgina-os-v1.png'
};

function loadBundled(id: string): Walkthrough | null {
  if (!Object.hasOwn(publications, id)) return null;
  return JSON.parse(publications[id]) as Walkthrough;
}

function stepCardPath(id: string, stepId: string): string {
  return `/og/${id}/${stepId}.png`;
}

// The walkthrough test suite ensures that every bundled Ask Gina step has a card on disk.
const STEP_CARD_PATHS = new Set(
  loadBundled(ASKGINA_OS_ID)?.steps.map(({ id }) => stepCardPath(ASKGINA_OS_ID, id))
);

function ogImageForId(id: string, stepId?: string): string | undefined {
  if (stepId === undefined) return Object.hasOwn(OG_IMAGES, id) ? OG_IMAGES[id] : undefined;
  const path = stepCardPath(id, stepId);
  return STEP_CARD_PATHS.has(path) ? path : undefined;
}

function buildLlmsTxt(origin: string, slugs: string[]): string {
  const lines = [
    '# Isodia Architecture Walkthroughs',
    '',
    '> Public, read-only interactive architecture walkthroughs published with Isodia.',
    '',
    '## Walkthroughs',
    ''
  ];
  for (const slug of slugs) {
    const story = loadBundled(slug);
    if (!story) continue;
    lines.push(`- [${story.title}](${origin}/w/${slug}.md): ${walkthroughDescription(story)}`);
    lines.push(`  - Interactive view: ${origin}/w/${slug}`);
    lines.push(`  - JSON API: ${origin}/api/walkthroughs/${slug}`);
    lines.push(`  - Source repository: ${story.articleUrl}`);
  }
  lines.push('');
  lines.push('## Discovery');
  lines.push('');
  lines.push(`- [API Catalog (RFC 9727)](${origin}/.well-known/api-catalog)`);
  lines.push(`- [ARD Catalog](${origin}/.well-known/ard.json)`);
  lines.push(`- [Sitemap](${origin}/sitemap.xml)`);
  lines.push('');
  return lines.join('\n');
}

/**
 * A reader-only Worker: the published walkthroughs bundled at build time and the web app files
 * they need. No workspace, editor, API, MCP or secret. Every request runs here first, so any
 * path that is not a bundled walkthrough, a discovery file, or a built asset is 404.
 */
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    const { pathname, origin } = url;
    if (pathname.startsWith('/assets/') || pathname === OG_IMAGES[ASKGINA_OS_ID] || STEP_CARD_PATHS.has(pathname)) {
      return env.ASSETS.fetch(request);
    }
    const slugs = Object.keys(publications);
    const primarySlug = slugs.length === 1 ? slugs[0] : undefined;

    if (pathname === '/robots.txt') {
      return new Response(
        `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,
        { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } },
      );
    }

    if (pathname === '/sitemap.xml') {
      const urls = slugs.flatMap((slug) => [
        `  <url><loc>${origin}/w/${slug}</loc></url>`,
        `  <url><loc>${origin}/w/${slug}.md</loc></url>`
      ]);
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
      return new Response(xml, {
        status: 200,
        headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' }
      });
    }

    if (pathname === '/llms.txt' || pathname === '/llms-full.txt' || pathname === '/docs/llms.txt' || pathname === '/api/llms.txt') {
      const body = pathname === '/llms-full.txt' && primarySlug
        ? (() => {
            const story = loadBundled(primarySlug);
            return story ? walkthroughMarkdown(story, { origin, id: primarySlug, ogImagePath: OG_IMAGES[primarySlug] }) : buildLlmsTxt(origin, slugs);
          })()
        : pathname === '/api/llms.txt'
          ? [
              '# Isodia Walkthrough Reader API',
              '',
              '> Public, read-only JSON and Markdown endpoints for published architecture walkthroughs.',
              '',
              `- [OpenAPI 3.1 Specification](${origin}/openapi.json)`,
              `- [API Documentation](${origin}/docs)`,
              ...slugs.map((slug) => `- [GET /api/walkthroughs/${slug}](${origin}/api/walkthroughs/${slug})`)
            ].join('\n') + '\n'
          : buildLlmsTxt(origin, slugs);
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=3600' }
      });
    }

    if (pathname === '/openapi.json') {
      const spec = {
        openapi: '3.1.0',
        info: {
          title: 'Isodia Walkthrough Reader API',
          version: '1.0.0',
          description: 'Public, read-only API for fetching published Isodia architecture walkthrough snapshots.'
        },
        servers: [{ url: origin }],
        paths: {
          '/api/walkthroughs/{id}': {
            get: {
              operationId: 'getWalkthrough',
              summary: 'Fetch a published walkthrough snapshot by slug',
              parameters: [
                {
                  name: 'id',
                  in: 'path',
                  required: true,
                  schema: { type: 'string', enum: slugs }
                }
              ],
              responses: {
                '200': {
                  description: 'Validated walkthrough JSON snapshot',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        required: ['schemaVersion', 'title', 'articleUrl', 'steps', 'model'],
                        properties: {
                          schemaVersion: { type: 'integer', const: 1 },
                          title: { type: 'string' },
                          articleUrl: { type: 'string', format: 'uri' },
                          steps: { type: 'array', items: { type: 'object' } },
                          model: { type: 'object' }
                        }
                      }
                    }
                  }
                },
                '404': {
                  description: 'Walkthrough not available',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        required: ['error'],
                        properties: { error: { type: 'string' } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };
      return new Response(JSON.stringify(spec, null, 2), {
        status: 200,
        headers: { 'content-type': 'application/openapi+json; charset=utf-8', 'cache-control': 'public, max-age=3600' }
      });
    }

    if (pathname === '/docs' || pathname === '/about' || pathname === '/privacy') {
      const title = pathname === '/docs' ? 'API & Walkthrough Documentation' : pathname === '/about' ? 'About Isodia Walkthroughs' : 'Privacy';
      const md = pathname === '/docs'
        ? `# ${title}\n\nThis host serves public, read-only architecture walkthrough snapshots published with [Isodia](https://github.com/ericjuta/isodia-mcp).\n\n## Endpoints\n\n- \`GET /api/walkthroughs/{id}\` — JSON snapshot\n- \`GET /w/{id}\` — Interactive walkthrough (HTML, or Markdown with \`Accept: text/markdown\`)\n- \`GET /w/{id}.md\` — Markdown walkthrough\n- \`GET /openapi.json\` — OpenAPI 3.1 specification\n- \`GET /llms.txt\` — Agent index\n`
        : pathname === '/about'
          ? `# ${title}\n\nIsodia publishes interactive, read-only isometric architecture walkthroughs from reviewed snapshots. Source code: https://github.com/ericjuta/isodia-mcp.\n`
          : `# ${title}\n\nThis reader serves static, public, read-only walkthrough snapshots. It sets no cookies, requires no login, and collects no personal data.\n`;
      if (prefersMarkdown(request)) {
        return new Response(md, {
          status: 200,
          headers: { 'content-type': 'text/markdown; charset=utf-8', 'vary': 'Accept, User-Agent', 'cache-control': 'public, max-age=3600' }
        });
      }
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Isodia</title><link rel="canonical" href="${origin}${pathname}"></head><body style="max-width:48rem;margin:2rem auto;padding:0 1.25rem;font-family:system-ui,sans-serif;line-height:1.6"><h1>${title}</h1><p>${pathname === '/docs' ? `Public, read-only walkthrough API and documentation. See the <a href="${origin}/openapi.json">OpenAPI 3.1 spec</a>, <a href="${origin}/llms.txt">llms.txt</a>, or <a href="${origin}/w/${primarySlug ?? ''}">interactive walkthrough</a>.` : pathname === '/about' ? 'Isodia publishes interactive, read-only isometric architecture walkthroughs from reviewed snapshots. Source code is at <a href="https://github.com/ericjuta/isodia-mcp">github.com/ericjuta/isodia-mcp</a>.' : 'This reader serves static, public, read-only walkthrough snapshots. It sets no cookies, requires no login, and collects no personal data.'}</p><nav><a href="${origin}/">Walkthrough</a> · <a href="${origin}/docs">Docs</a> · <a href="${origin}/about">About</a> · <a href="${origin}/privacy">Privacy</a></nav></body></html>`;
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'vary': 'Accept, User-Agent', 'cache-control': 'public, max-age=3600' }
      });
    }

    if (pathname === '/index.md' && primarySlug) {
      const story = loadBundled(primarySlug);
      if (story) {
        return new Response(
          walkthroughMarkdown(story, { origin, id: primarySlug, ogImagePath: OG_IMAGES[primarySlug] }),
          { status: 200, headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' } },
        );
      }
    }

    if (pathname === '/.well-known/api-catalog') {
      const linkset = {
        linkset: slugs.map((slug) => ({
          anchor: `${origin}/api/walkthroughs/${slug}`,
          'service-desc': [{ href: `${origin}/openapi.json`, type: 'application/openapi+json' }],
          'service-doc': [{ href: `${origin}/docs`, type: 'text/html' }]
        }))
      };
      return new Response(JSON.stringify(linkset, null, 2), {
        status: 200,
        headers: {
          'content-type': 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
          'cache-control': 'public, max-age=3600'
        }
      });
    }

    if (pathname === '/.well-known/ard.json') {
      const ard = {
        version: '1.0',
        name: 'Isodia Architecture Walkthroughs',
        description: 'Public, read-only interactive architecture walkthroughs published with Isodia.',
        entries: slugs.map((slug) => {
          const story = loadBundled(slug);
          return {
            id: slug,
            displayName: story?.title ?? slug,
            description: story ? walkthroughDescription(story) : '',
            url: `${origin}/w/${slug}`,
            markdownUrl: `${origin}/w/${slug}.md`,
            apiUrl: `${origin}/api/walkthroughs/${slug}`
          };
        })
      };
      return new Response(JSON.stringify(ard, null, 2), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' }
      });
    }

    if (pathname === '/' && primarySlug) {
      if (prefersMarkdown(request)) {
        const story = loadBundled(primarySlug);
        if (story) {
          return new Response(
            walkthroughMarkdown(story, { origin, id: primarySlug, ogImagePath: OG_IMAGES[primarySlug] }),
            {
              status: 200,
              headers: {
                'content-type': 'text/markdown; charset=utf-8',
                'vary': 'Accept, User-Agent',
                'cache-control': 'no-store'
              }
            },
          );
        }
      }
      return Response.redirect(new URL(`/w/${primarySlug}`, request.url).toString(), 302);
    }

    if (pathname.startsWith('/w/') || pathname.startsWith('/api/walkthroughs/')) {
      const reader = new Hono();
      addWalkthroughRoutes(
        reader,
        bundledWalkthroughs(env.ASSETS),
        (id) => (id === ASKGINA_OS_ID ? ['https://app.notion.com', 'https://www.notion.so'] : []),
        ogImageForId,
      );
      return reader.fetch(request);
    }

    if (prefersMarkdown(request)) {
      return new Response('# 404 Not Found\n\nThe requested resource does not exist.\n', {
        status: 404,
        headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store', 'vary': 'Accept, User-Agent' }
      });
    }
    return new Response('Not found.', { status: 404, headers: { 'cache-control': 'no-store' } });
  }
} satisfies ExportedHandler<ReaderEnv>;
