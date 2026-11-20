import { Hono } from 'hono';
import publications from 'virtual:isodia/walkthroughs';
import type { Walkthrough } from '../core/walkthrough';
import { addWalkthroughRoutes } from '../server/walkthroughs';
import { prefersMarkdown, walkthroughDescription, walkthroughMarkdown } from '../server/walkthrough-seo';
import { bundledWalkthroughs } from './walkthroughs';

interface ReaderEnv {
  ASSETS: Fetcher;
}

const OG_IMAGES: Record<string, string> = {
  'askgina-os-v1': '/og-askgina-os-v1.png'
};

function loadBundled(id: string): Walkthrough | null {
  if (!Object.hasOwn(publications, id)) return null;
  return JSON.parse(publications[id]) as Walkthrough;
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
    if (pathname.startsWith('/assets/') || pathname === '/og-askgina-os-v1.png') {
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

    if (pathname === '/llms.txt' || pathname === '/llms-full.txt') {
      const body = pathname === '/llms-full.txt' && primarySlug
        ? (() => {
            const story = loadBundled(primarySlug);
            return story ? walkthroughMarkdown(story, { origin, id: primarySlug, ogImagePath: OG_IMAGES[primarySlug] }) : buildLlmsTxt(origin, slugs);
          })()
        : buildLlmsTxt(origin, slugs);
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=3600' }
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
          'service-desc': [{ href: `${origin}/w/${slug}.md`, type: 'text/markdown' }],
          'service-doc': [{ href: `${origin}/w/${slug}`, type: 'text/html' }]
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
        (id) => (id === 'askgina-os-v1' ? ['https://app.notion.com', 'https://www.notion.so'] : []),
        (id) => OG_IMAGES[id],
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
