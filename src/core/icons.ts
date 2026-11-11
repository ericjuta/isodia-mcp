import { createRequire } from 'node:module';
import type { Icon, Model } from './types';

const require = createRequire(import.meta.url);

export const ICON_COLLECTIONS = ['isoflow', 'aws', 'azure', 'gcp', 'kubernetes'] as const;
export type IconCollection = (typeof ICON_COLLECTIONS)[number];

const { flattenCollections } = require('@isoflow/isopacks/dist/utils') as {
  flattenCollections(packs: unknown[]): Icon[];
};

const loadPack = (id: IconCollection): unknown => {
  const mod = require(`@isoflow/isopacks/dist/${id}`) as { default?: unknown };
  return mod.default ?? mod;
};

/** Every bundled icon, flattened exactly as the editor's own examples do. */
export const ICON_CATALOG: readonly Icon[] = flattenCollections(ICON_COLLECTIONS.map(loadPack));

const catalogById = new Map(ICON_CATALOG.map((icon) => [icon.id, icon]));

export const catalogIcon = (id: string): Icon | undefined => catalogById.get(id);

export type IconSummary = Omit<Icon, 'url'>;

const WORD_BREAK = /[^a-z0-9]+/;

/**
 * Rank catalog icons against free text. An icon matches when any query word appears in its id;
 * whole-word hits outrank prefix hits, which outrank substring hits. An empty query lists the
 * collection in catalog order.
 */
export function searchIcons(
  query: string,
  options: { collection?: IconCollection; limit?: number } = {}
): IconSummary[] {
  const pool = options.collection
    ? ICON_CATALOG.filter((icon) => icon.collection === options.collection)
    : ICON_CATALOG;
  const queryWords = query.toLowerCase().split(WORD_BREAK).filter(Boolean);

  let matches = pool;
  if (queryWords.length > 0) {
    const ranked: { icon: Icon; score: number }[] = [];
    for (const icon of pool) {
      const haystack = icon.id.toLowerCase();
      const iconWords = haystack.split(WORD_BREAK).filter(Boolean);
      let score = 0;
      for (const word of queryWords) {
        if (iconWords.includes(word)) score += 4;
        else if (iconWords.some((candidate) => candidate.startsWith(word))) score += 2;
        else if (haystack.includes(word)) score += 1;
      }
      if (score > 0) ranked.push({ icon, score });
    }
    ranked.sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.icon.isIsometric ?? false) - Number(a.icon.isIsometric ?? false) ||
        a.icon.id.length - b.icon.id.length ||
        a.icon.id.localeCompare(b.icon.id)
    );
    matches = ranked.map(({ icon }) => icon);
  }

  return matches
    .slice(0, options.limit ?? 20)
    .map(({ id, name, collection, isIsometric }) => ({ id, name, collection, isIsometric }));
}

/** The icon an item id resolves to: a custom icon stored on the model wins over the catalog. */
export const resolveIcon = (model: Model, id: string): Icon | undefined =>
  model.icons.find((icon) => icon.id === id) ?? catalogIcon(id);

/**
 * Stored models keep only custom icons. This returns the standalone form the editor's schema
 * accepts: custom icons plus every catalog icon an item references.
 */
export function withReferencedIcons(model: Model): Model {
  const present = new Set(model.icons.map((icon) => icon.id));
  const added: Icon[] = [];
  for (const item of model.items) {
    if (!item.icon || present.has(item.icon)) continue;
    const icon = catalogIcon(item.icon);
    if (!icon) continue;
    present.add(icon.id);
    added.push(icon);
  }
  return added.length === 0 ? model : { ...model, icons: [...model.icons, ...added] };
}

/** Drop icons that are byte-identical to the bundled catalog, leaving only custom ones. */
export function withoutCatalogIcons(model: Model): Model {
  const custom = model.icons.filter((icon) => catalogIcon(icon.id)?.url !== icon.url);
  return custom.length === model.icons.length ? model : { ...model, icons: custom };
}
