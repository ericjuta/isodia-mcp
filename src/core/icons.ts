import { ICON_DEFINITIONS } from './iconset/icons';
import { Pen } from './iconset/pen';
import type { Icon, Model } from './types';

/**
 * The bundled icon set, drawn from code in `iconset/`. It runs unchanged on the server and in
 * the browser, so both resolve the same ids to the same pictures.
 */

const toDataUrl = (svg: string): string => `data:image/svg+xml;base64,${btoa(svg)}`;

/** Every bundled icon. */
export const ICON_CATALOG: readonly Icon[] = ICON_DEFINITIONS.map((definition) => {
  const pen = new Pen();
  definition.draw(pen);
  return { id: definition.id, name: definition.name, url: toDataUrl(pen.svg()), collection: 'isodia', isIsometric: true };
});

const catalogById = new Map(ICON_CATALOG.map((icon) => [icon.id, icon]));

export const catalogIcon = (id: string): Icon | undefined => catalogById.get(id);

export type IconSummary = Omit<Icon, 'url'>;

const WORD_BREAK = /[^a-z0-9]+/;
const words = (text: string): string[] => text.toLowerCase().split(WORD_BREAK).filter(Boolean);

/** Other names each icon answers to. Kept beside the catalog: `Icon` is the stored model format. */
const KEYWORDS = new Map(ICON_DEFINITIONS.map((definition) => [definition.id, words(`${definition.name} ${definition.keywords}`)]));

/**
 * Rank icons against free text. A query word scores most as a whole word of the id, then as
 * the start of one, then as another name for the icon, then as part of the id. An empty query
 * lists the set in catalog order.
 */
export function searchIcons(query: string, options: { limit?: number } = {}): IconSummary[] {
  const queryWords = words(query);
  let matches: readonly Icon[] = ICON_CATALOG;
  if (queryWords.length > 0) {
    const ranked: { icon: Icon; score: number }[] = [];
    for (const icon of ICON_CATALOG) {
      const id = icon.id.toLowerCase();
      const idWords = words(id);
      const other = KEYWORDS.get(icon.id) ?? [];
      let score = 0;
      for (const word of queryWords) {
        if (idWords.includes(word)) score += 8;
        else if (idWords.some((candidate) => candidate.startsWith(word))) score += 4;
        else if (other.includes(word)) score += 3;
        else if (id.includes(word) || other.some((candidate) => candidate.startsWith(word))) score += 1;
      }
      if (score > 0) ranked.push({ icon, score });
    }
    ranked.sort((a, b) => b.score - a.score || a.icon.id.length - b.icon.id.length || a.icon.id.localeCompare(b.icon.id));
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
 * Stored models keep only custom icons. This returns the standalone form: custom icons plus
 * every bundled icon an item references, so the file is complete on its own.
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

/**
 * Drop icons that the bundled set already provides under the same id, leaving only custom ones.
 * An embedded copy of a bundled icon (from an export, possibly of an older drawing) is the same
 * icon by name, and the current drawing is the one to show.
 */
export function withoutCatalogIcons(model: Model): Model {
  const custom = model.icons.filter((icon) => {
    const bundled = catalogIcon(icon.id);
    return !bundled || !(icon.collection === 'isodia' || icon.collection === 'isoflow' || icon.url === bundled.url);
  });
  return custom.length === model.icons.length ? model : { ...model, icons: custom };
}
