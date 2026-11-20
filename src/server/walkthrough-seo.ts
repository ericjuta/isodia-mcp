import type { Walkthrough } from '../core/walkthrough';

export interface WalkthroughSeoOptions {
  /** Absolute origin (e.g. https://example.com) */
  origin: string;
  /** Walkthrough slug (e.g. askgina-os-v1) */
  id: string;
  /** Optional relative path to OG image (e.g. /og-askgina-os-v1.png) */
  ogImagePath?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function walkthroughDescription(story: Walkthrough): string {
  const first = story.steps[0]?.body.trim() ?? '';
  if (first.length <= 200) return first;
  return `${first.slice(0, 197).trimEnd()}...`;
}

export function walkthroughMarkdown(story: Walkthrough, options: WalkthroughSeoOptions): string {
  const canonicalUrl = `${options.origin}/w/${options.id}`;
  const lines: string[] = [
    '---',
    `title: ${JSON.stringify(story.title)}`,
    `url: ${JSON.stringify(canonicalUrl)}`,
    `source: ${JSON.stringify(story.articleUrl)}`,
    `steps: ${story.steps.length}`,
    `views: ${story.model.views.length}`,
    '---',
    '',
    `# ${story.title}`,
    '',
    walkthroughDescription(story),
    '',
    `- Interactive walkthrough: ${canonicalUrl}`,
    `- Source repository: ${story.articleUrl}`,
    `- JSON API: ${options.origin}/api/walkthroughs/${options.id}`,
    '',
    '## Guided steps',
    ''
  ];

  for (const [index, step] of story.steps.entries()) {
    lines.push(`### ${index + 1}. ${step.title}`);
    lines.push('');
    lines.push(step.body);
    lines.push('');
    lines.push(`- Step link: ${canonicalUrl}?step=${step.id}`);
    lines.push(`- Diagram view: ${step.view}`);
    if (step.component) {
      const item = story.model.items.find((candidate) => candidate.id === step.component);
      if (item) {
        lines.push(`- Focused component: ${item.name}`);
      }
    }
    lines.push('');
  }

  lines.push('## Components');
  lines.push('');
  for (const item of story.model.items) {
    const desc = item.description?.trim();
    lines.push(desc ? `- **${item.name}**: ${desc}` : `- **${item.name}**`);
  }
  lines.push('');
  return lines.join('\n');
}

export function walkthroughJsonLd(story: Walkthrough, options: WalkthroughSeoOptions): string {
  const canonicalUrl = `${options.origin}/w/${options.id}`;
  const description = walkthroughDescription(story);
  const imageUrl = options.ogImagePath ? `${options.origin}${options.ogImagePath}` : undefined;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${options.origin}/#organization`,
        name: 'Isodia',
        url: options.origin,
        sameAs: ['https://github.com/ericjuta/isodia-mcp', story.articleUrl]
      },
      {
        '@type': 'WebSite',
        '@id': `${options.origin}/#website`,
        name: story.title,
        url: options.origin,
        publisher: { '@id': `${options.origin}/#organization` }
      },
      {
        '@type': 'TechArticle',
        '@id': `${canonicalUrl}#article`,
        headline: story.title,
        name: story.title,
        description,
        url: canonicalUrl,
        ...(imageUrl ? { image: imageUrl } : {}),
        isPartOf: { '@id': `${options.origin}/#website` },
        author: { '@id': `${options.origin}/#organization` },
        sameAs: [story.articleUrl]
      }
    ]
  };
  return JSON.stringify(graph).replaceAll('<', '\\u003c');
}

export function renderWalkthroughFallbackHtml(story: Walkthrough, options: WalkthroughSeoOptions): string {
  const canonicalUrl = `${options.origin}/w/${options.id}`;
  const stepsHtml = story.steps
    .map(
      (step, index) =>
        `<li><h3><a href="${escapeHtml(`${canonicalUrl}?step=${step.id}`)}">${index + 1}. ${escapeHtml(step.title)}</a></h3><p>${escapeHtml(step.body)}</p></li>`,
    )
    .join('');
  return `<main id="walkthrough-static" style="max-width:48rem;margin:2rem auto;padding:0 1.25rem;font-family:system-ui,sans-serif;line-height:1.6"><h1>${escapeHtml(story.title)}</h1><p>${escapeHtml(walkthroughDescription(story))}</p><nav><a href="${escapeHtml(story.articleUrl)}">Source repository</a> · <a href="${escapeHtml(`${options.origin}/w/${options.id}.md`)}">Markdown</a> · <a href="${escapeHtml(`${options.origin}/docs`)}">API Docs</a> · <a href="${escapeHtml(`${options.origin}/openapi.json`)}">OpenAPI</a> · <a href="${escapeHtml(`${options.origin}/about`)}">About</a> · <a href="${escapeHtml(`${options.origin}/privacy`)}">Privacy</a></nav><ol>${stepsHtml}</ol></main>`;
}

/**
 * Enrich the SPA HTML shell with per-walkthrough social metadata (Open Graph + Twitter Card),
 * canonical/markdown alternate links, JSON-LD structured data, and semantic no-JS fallback content
 * inside `<div id="root">` (which React replaces on mount).
 */
export function enhanceWalkthroughHtml(
  html: string,
  story: Walkthrough,
  options: WalkthroughSeoOptions,
): string {
  const canonicalUrl = `${options.origin}/w/${options.id}`;
  const markdownUrl = `${options.origin}/w/${options.id}.md`;
  const description = walkthroughDescription(story);
  const imageUrl = options.ogImagePath ? `${options.origin}${options.ogImagePath}` : undefined;
  const escapedTitle = escapeHtml(story.title);
  const escapedDesc = escapeHtml(description);
  const escapedCanonical = escapeHtml(canonicalUrl);
  const escapedMarkdown = escapeHtml(markdownUrl);

  const headTags = [
    `<meta name="description" content="${escapedDesc}" />`,
    `<link rel="canonical" href="${escapedCanonical}" />`,
    `<link rel="alternate" type="text/markdown" href="${escapedMarkdown}" title="${escapedTitle} (Markdown)" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="Isodia" />`,
    `<meta property="og:title" content="${escapedTitle}" />`,
    `<meta property="og:description" content="${escapedDesc}" />`,
    `<meta property="og:url" content="${escapedCanonical}" />`,
    ...(imageUrl
      ? [
          `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
          `<meta property="og:image:alt" content="${escapedTitle} architecture overview diagram" />`,
          `<meta name="twitter:card" content="summary_large_image" />`,
          `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`
        ]
      : [`<meta name="twitter:card" content="summary" />`]),
    `<meta name="twitter:title" content="${escapedTitle}" />`,
    `<meta name="twitter:description" content="${escapedDesc}" />`,
    `<script type="application/ld+json">${walkthroughJsonLd(story, options)}</script>`
  ].join('\n    ');

  let out = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapedTitle} — Isodia</title>\n    ${headTags}`);
  const fallback = renderWalkthroughFallbackHtml(story, options);
  out = out.replace('<div id="root"></div>', `<div id="root">${fallback}</div>`);
  return out;
}

export function prefersMarkdown(request: Request): boolean {
  const accept = (request.headers.get('accept') ?? '').toLowerCase();
  if (accept.includes('text/markdown')) return true;
  const ua = request.headers.get('user-agent') ?? '';
  if (/\b(ChatGPT-User|Claude-User|Perplexity-User|OAI-SearchBot)\b/i.test(ua) && !accept.includes('application/json')) {
    return true;
  }
  return false;
}
