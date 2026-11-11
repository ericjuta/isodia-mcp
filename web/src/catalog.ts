import awsPack from '@isoflow/isopacks/dist/aws';
import azurePack from '@isoflow/isopacks/dist/azure';
import gcpPack from '@isoflow/isopacks/dist/gcp';
import isoflowPack from '@isoflow/isopacks/dist/isoflow';
import kubernetesPack from '@isoflow/isopacks/dist/kubernetes';
import type { Icon, Model } from '../../src/core/types';

interface IconPack {
  id: string;
  icons: Omit<Icon, 'collection'>[];
}

/**
 * The isopacks are CommonJS bundles that also mark themselves `__esModule`, so a bundler hands
 * back the module namespace rather than the pack: `{ __esModule: true, default: pack }`.
 */
function packOf(module: unknown): IconPack {
  if (module === null || typeof module !== 'object') throw new Error('An icon pack did not load.');
  if ('icons' in module) return module as IconPack;
  if ('default' in module) return packOf(module.default);
  throw new Error('An icon pack has no icons.');
}

/**
 * The bundled icon catalog, in the same collection order the server uses. Projects are stored
 * without these icons; the browser adds them for the editor and removes them before saving.
 * This module carries megabytes of inlined SVG, so pages reach it through a lazy import.
 */
const icons: Icon[] = [isoflowPack, awsPack, azurePack, gcpPack, kubernetesPack].flatMap((module) => {
  const pack = packOf(module);
  return pack.icons.map((icon) => ({ ...icon, collection: pack.id }));
});
const urlById = new Map(icons.map((icon) => [icon.id, icon.url]));

/** The model with the whole catalog available to the editor; a custom icon wins over its catalog namesake. */
export function hydrate(model: Model): Model {
  const custom = new Set(model.icons.map((icon) => icon.id));
  return { ...model, icons: [...icons.filter((icon) => !custom.has(icon.id)), ...model.icons] };
}

/** The model as it is stored: without icons identical to the catalog's. */
export function strip(model: Model): Model {
  return { ...model, icons: model.icons.filter((icon) => urlById.get(icon.id) !== icon.url) };
}
