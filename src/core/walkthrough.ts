import { z } from 'zod';
import { withReferencedIcons } from './icons';
import { parseModel } from './schema';
import type { Model } from './types';

export const walkthroughId = z.string().max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const WALKTHROUGH_MAX_BYTES = 5 * 1024 * 1024;

const articleUrl = z.string().trim().max(2000).transform((value, ctx) => {
  try {
    const url = new URL(value);
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    // The canonical host is emitted into frame-ancestors, so refuse CSP separators as well.
    const safeHost = /^(?:[a-z0-9.-]+|\[[a-f0-9:.]+\])$/.test(url.hostname);
    if ((url.protocol === 'https:' || local) && safeHost && !url.username && !url.password && url.href.length <= 2000) {
      return url.href;
    }
  } catch {
    // Report one error for both malformed URLs and disallowed destinations.
  }
  ctx.addIssue({ code: 'custom', message: 'Use an absolute HTTPS article URL (HTTP is allowed on loopback for preview).' });
  return z.NEVER;
});

const stepSchema = z.strictObject({
  id: walkthroughId,
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(4000),
  view: z.string().min(1),
  component: z.string().min(1).optional()
});
const storySchema = z.strictObject({
  schemaVersion: z.literal(1),
  title: z.string().trim().min(1).max(100),
  articleUrl,
  steps: z.array(stepSchema).min(1).max(30)
});
const authorSchema = storySchema.extend({ views: z.array(z.string().min(1)).min(1) });
const publicationSchema = storySchema.extend({ model: z.unknown() });

export type Walkthrough = z.output<typeof storySchema> & { model: Model };

export class WalkthroughError extends Error {}

function checkSteps(steps: Walkthrough['steps'], model: Model): void {
  const ids = new Set<string>();
  for (const step of steps) {
    if (ids.has(step.id)) throw new WalkthroughError(`Duplicate step id "${step.id}".`);
    ids.add(step.id);
    const view = model.views.find((candidate) => candidate.id === step.view);
    if (!view) throw new WalkthroughError(`Step "${step.id}" needs a published view; "${step.view}" is not included.`);
    if (step.component !== undefined && !view.items.some((item) => item.id === step.component)) {
      throw new WalkthroughError(`Step "${step.id}" focuses component "${step.component}", which is not in view "${step.view}".`);
    }
  }
}

/** Select a closed subset of the model, including the artwork and palette entries it uses. */
function project(model: Model, views: Model['views'], title: string): Model {
  const itemIds = new Set(views.flatMap((view) => view.items.map(({ id }) => id)));
  const items = model.items.filter(({ id }) => itemIds.has(id));
  const iconIds = new Set(items.map(({ icon }) => icon));
  const colors = new Set(views.flatMap((view) => [
    ...(view.connectors ?? []).map(({ color }) => color),
    ...(view.rectangles ?? []).map(({ color }) => color)
  ]));
  return {
    title,
    items,
    views: views.map(({ lastUpdated: _lastUpdated, ...view }) => view),
    icons: model.icons.filter(({ id }) => iconIds.has(id)),
    colors: model.colors.filter(({ id }) => colors.has(id))
  };
}

/** Offline only: prepare a file for review. No editor or project identifier survives here. */
export function prepareWalkthrough(source: unknown, manifest: unknown): Walkthrough {
  const model = parseModel(source);
  const { views: wanted, ...story } = authorSchema.parse(manifest);
  if (new Set(wanted).size !== wanted.length) throw new WalkthroughError('The published view list contains a duplicate.');
  const views = wanted.map((id) => {
    const view = model.views.find((candidate) => candidate.id === id);
    if (!view) throw new WalkthroughError(`Unknown published view "${id}".`);
    return view;
  });
  const snapshot = parseModel(withReferencedIcons(project(model, views, story.title)));
  checkSteps(story.steps, snapshot);
  return { ...story, model: snapshot };
}

/** Refuse malformed or untrimmed files instead of exposing unreviewed extra model data. */
export function parseWalkthrough(input: unknown): Walkthrough {
  const { model: raw, ...story } = publicationSchema.parse(input);
  const model = parseModel(raw);
  if (model.views.length === 0) throw new WalkthroughError('A walkthrough needs at least one view.');
  const projected = project(model, model.views, story.title);
  if (JSON.stringify(projected) !== JSON.stringify(model)) {
    throw new WalkthroughError('The model contains data outside the publication projection. Run the preparation command.');
  }
  if (withReferencedIcons(model) !== model) throw new WalkthroughError('The snapshot must carry its referenced icons.');
  checkSteps(story.steps, model);
  return { ...story, model };
}
