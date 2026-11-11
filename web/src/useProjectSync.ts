import { useCallback, useEffect, useRef, useState } from 'react';
import type { Model } from '../../src/core/types';
import { ApiError, api } from './api';
import type { Shown } from './Diagram';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

export interface ProjectSync {
  phase: 'loading' | 'ready' | 'missing';
  name: string;
  revision: number;
  views: { id: string; name: string }[];
  viewId: string;
  shown: Shown | null;
  saveState: SaveState;
  /** A one-line message about the last sync event worth telling the user. */
  notice: string | null;
  dismissNotice(): void;
  /** Wire to the editor: receives the stored form of the model after every change. */
  onChange(model: Model): void;
  selectView(id: string): void;
  /** Apply a structural change the editor has no control for (views, title), then show `view`. */
  edit(change: (model: Model) => Model, view?: string): void;
  /** Discard local state and show what the server holds. */
  reload(): Promise<void>;
}

const AUTOSAVE_DELAY_MS = 600;
const POLL_INTERVAL_MS = 2000;

/**
 * JSON with keys sorted at every level. An edit can rebuild an object with its keys in another
 * order, so a plain `JSON.stringify` comparison would call an unchanged model unsaved.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Keeps one project in step with the server: autosaves editor changes against the revision
 * they were based on, and picks up changes made elsewhere (an agent over MCP, another tab).
 * When both sides changed, the server's version wins and the user is told.
 */
export function useProjectSync(projectId: string): ProjectSync {
  const [phase, setPhase] = useState<ProjectSync['phase']>('loading');
  const [meta, setMeta] = useState({ name: '', revision: 0 });
  const [views, setViews] = useState<{ id: string; name: string }[]>([]);
  const [viewId, setViewId] = useState('');
  const [shown, setShown] = useState<Shown | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [notice, setNotice] = useState<string | null>(null);

  /** The model as the editor last reported it. */
  const latest = useRef<Model | null>(null);
  /** JSON of the model the server is known to hold. */
  const synced = useRef('');
  const revision = useRef(0);
  const currentView = useRef(new URLSearchParams(window.location.search).get('view') ?? '');
  const saving = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((model: Model, view: string, fit: boolean) => {
    const target = model.views.some((candidate) => candidate.id === view) ? view : model.views[0].id;
    latest.current = model;
    currentView.current = target;
    setViewId(target);
    setViews(model.views.map(({ id, name }) => ({ id, name })));
    setShown({ model, view: target, fit });
    window.history.replaceState(null, '', `?view=${encodeURIComponent(target)}`);
  }, []);

  const load = useCallback(
    async (fit: boolean) => {
      try {
        const project = await api.getProject(projectId);
        revision.current = project.revision;
        synced.current = canonical(project.model);
        setMeta({ name: project.name, revision: project.revision });
        show(project.model, currentView.current, fit);
        setSaveState('saved');
        setPhase('ready');
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) setPhase('missing');
        else setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [projectId, show]
  );

  const save = useCallback(async () => {
    const model = latest.current;
    if (saving.current || model === null) return;
    const json = canonical(model);
    if (json === synced.current) {
      setSaveState('saved');
      return;
    }
    saving.current = true;
    setSaveState('saving');
    try {
      const saved = await api.saveModel(projectId, model, revision.current);
      revision.current = saved.revision;
      synced.current = json;
      setMeta({ name: model.title, revision: saved.revision });
    } catch (error) {
      saving.current = false;
      if (error instanceof ApiError && error.status === 409) {
        setNotice('This diagram was changed elsewhere, so the latest version is shown.');
        await load(false);
      } else {
        setSaveState('error');
        setNotice(`Not saved: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    saving.current = false;
    // The editor may have moved on while the request was in flight.
    if (latest.current !== null && canonical(latest.current) === synced.current) setSaveState('saved');
    else void save();
  }, [projectId, load]);

  const schedule = useCallback(() => {
    setSaveState('unsaved');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
  }, [save]);

  const onChange = useCallback(
    (model: Model) => {
      latest.current = model;
      if (canonical(model) !== synced.current) schedule();
    },
    [schedule]
  );

  const selectView = useCallback(
    (id: string) => {
      if (latest.current) show(latest.current, id, true);
    },
    [show]
  );

  const edit = useCallback(
    (change: (model: Model) => Model, view?: string) => {
      if (latest.current === null) return;
      show(change(latest.current), view ?? currentView.current, view !== undefined);
      schedule();
    },
    [show, schedule]
  );

  useEffect(() => {
    void load(true);
    return () => window.clearTimeout(timer.current);
  }, [load]);

  useEffect(() => {
    const poll = window.setInterval(async () => {
      if (saving.current || document.hidden) return;
      const asked = revision.current;
      try {
        const remote = await api.getRevision(projectId);
        // A save or load that finished while the poll was in flight outdates its answer; treating
        // that answer as news would report the editor's own save as a change made elsewhere.
        if (revision.current !== asked) return;
        const clean = latest.current !== null && canonical(latest.current) === synced.current;
        // With local edits pending, the next save meets the conflict and resolves it there.
        if (remote.revision !== revision.current && clean && !saving.current) {
          setNotice('Updated with changes made elsewhere.');
          await load(false);
        }
      } catch {
        // A failed poll is retried on the next tick.
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(poll);
  }, [projectId, load]);

  return {
    phase,
    name: meta.name,
    revision: meta.revision,
    views,
    viewId,
    shown,
    saveState,
    notice,
    dismissNotice: useCallback(() => setNotice(null), []),
    onChange,
    selectView,
    edit,
    reload: useCallback(() => load(true), [load])
  };
}
