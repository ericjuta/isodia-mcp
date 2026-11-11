import { Database } from 'bun:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { withoutCatalogIcons } from '../core/icons';
import { slug, uniqueId } from '../core/ids';
import { emptyModel, findView } from '../core/model';
import { parseModel } from '../core/schema';
import type { Model } from '../core/types';

export type RevisionSource = 'editor' | 'mcp' | 'api' | 'import' | 'restore';

export interface Project {
  id: string;
  name: string;
  /** Increases by one on every change; the basis for optimistic concurrency. */
  revision: number;
  /** Stored form: custom icons only. */
  model: Model;
  createdAt: string;
  updatedAt: string;
}

export type ProjectSummary = Omit<Project, 'model'>;

export interface RevisionSummary {
  number: number;
  source: RevisionSource;
  summary: string;
  label: string | null;
  createdAt: string;
}

export interface ShareLink {
  token: string;
  projectId: string;
  /** View the link opens on; `null` opens the first view. */
  viewId: string | null;
  createdAt: string;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** The project changed since the caller last read it. */
export class ConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super(`The project is now at revision ${currentRevision}; reload before saving.`);
    this.name = 'ConflictError';
  }
}

/**
 * Autosaves from the editor arrive every few seconds. Within one burst they replace each other
 * in the history, so a burst leaves at most one revision per window.
 */
const EDITOR_BURST_MS = 2 * 60 * 1000;

/**
 * Every revision stores a complete copy of the model, so an unbounded history grows with the
 * number of edits, not the size of the work. Keep the useful part of the history and drop the
 * old autosaves: the first revision, anything named, and the most recent window stay.
 */
const REVISION_WINDOW = 100;

interface ProjectRow {
  id: string;
  name: string;
  model: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface RevisionRow {
  number: number;
  source: RevisionSource;
  summary: string;
  label: string | null;
  started_at: string;
  created_at: string;
}

const toProject = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  revision: row.revision,
  model: JSON.parse(row.model) as Model,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

/**
 * The form a model is stored in: the schema's parsed output (so equal models serialise
 * identically), with catalog icons stripped, at least one view to edit, and a non-empty palette
 * for regions and connectors to draw from.
 */
function normalize(model: Model): Model {
  const blank = emptyModel(model.title);
  const complete = {
    ...model,
    views: model.views.length > 0 ? model.views : blank.views,
    colors: model.colors.length > 0 ? model.colors : blank.colors
  };
  return withoutCatalogIcons(parseModel(complete));
}

export class Store {
  private readonly db: Database;
  private readonly now: () => Date;

  constructor(path: string, options: { now?: () => Date } = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.now = options.now ?? (() => new Date());
    // WAL and a busy timeout let the HTTP server and stdio MCP processes share one file.
    this.db.run('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    this.db.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        model TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS revisions (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        number INTEGER NOT NULL,
        model TEXT NOT NULL,
        source TEXT NOT NULL,
        summary TEXT NOT NULL,
        label TEXT,
        started_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, number)
      );
      CREATE TABLE IF NOT EXISTS share_links (
        token TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        view_id TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  private row(id: string): ProjectRow {
    const row = this.db.query<ProjectRow, [string]>('SELECT * FROM projects WHERE id = ?').get(id);
    if (!row) {
      const known = this.listProjects().map((project) => project.id);
      throw new NotFoundError(`Unknown project "${id}". Projects: ${known.join(', ') || 'none'}.`);
    }
    return row;
  }

  listProjects(): ProjectSummary[] {
    return this.db
      .query<Omit<ProjectRow, 'model'>, []>(
        'SELECT id, name, revision, created_at, updated_at FROM projects ORDER BY updated_at DESC, id'
      )
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        revision: row.revision,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
  }

  getProject(id: string): Project {
    return toProject(this.row(id));
  }

  /** Create an empty project, or one holding `model` (whose title becomes the name). */
  createProject(input: { name: string; description?: string; model?: Model }, source: RevisionSource): Project {
    const model = normalize(
      input.model ? { ...input.model, title: input.name } : emptyModel(input.name, input.description)
    );
    return this.db
      .transaction(() => {
        const taken = this.db.query<{ id: string }, []>('SELECT id FROM projects').all();
        const id = uniqueId(
          slug(input.name),
          taken.map((row) => row.id)
        );
        const now = this.now().toISOString();
        const json = JSON.stringify(model);
        this.db
          .query('INSERT INTO projects (id, name, model, revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
          .run(id, model.title, json, now, now);
        this.db
          .query(
            'INSERT INTO revisions (project_id, number, model, source, summary, label, started_at, created_at) VALUES (?, 1, ?, ?, ?, NULL, ?, ?)'
          )
          .run(id, json, source, 'Created project', now, now);
        return this.getProject(id);
      })
      .immediate();
  }

  /** Create a project from Isoflow model JSON of unknown provenance; absent collections are empty. */
  importProject(raw: Record<string, unknown>, name?: string): Project {
    const title = typeof raw.title === 'string' && raw.title !== '' ? raw.title : 'Imported diagram';
    // The cast is checked immediately: createProject validates against the model schema.
    const model = { items: [], views: [], icons: [], colors: [], ...raw, title } as Model;
    return this.createProject({ name: name ?? title, model }, 'import');
  }

  deleteProject(id: string): void {
    this.row(id);
    this.db.query('DELETE FROM projects WHERE id = ?').run(id);
  }

  /**
   * Read-modify-write under one write lock. `change` receives the stored model and returns the
   * next one; an unchanged result records nothing. Throws `ConflictError` when
   * `expectedRevision` is given and stale.
   */
  updateModel(
    id: string,
    meta: { source: RevisionSource; summary: string; expectedRevision?: number },
    change: (current: Model) => Model
  ): Project {
    return this.db
      .transaction(() => {
        const row = this.row(id);
        if (meta.expectedRevision !== undefined && meta.expectedRevision !== row.revision) {
          throw new ConflictError(row.revision);
        }
        const model = normalize(change(JSON.parse(row.model) as Model));
        const json = JSON.stringify(model);
        if (json === row.model) return toProject(row);

        const now = this.now();
        const stamp = now.toISOString();
        const head = this.db
          .query<RevisionRow, [string, number]>(
            'SELECT number, source, summary, label, started_at, created_at FROM revisions WHERE project_id = ? AND number = ?'
          )
          .get(id, row.revision);
        const continuesBurst =
          meta.source === 'editor' &&
          head?.source === 'editor' &&
          head.label === null &&
          now.getTime() - Date.parse(head.started_at) < EDITOR_BURST_MS;
        if (continuesBurst) {
          this.db.query('DELETE FROM revisions WHERE project_id = ? AND number = ?').run(id, row.revision);
        }

        const revision = row.revision + 1;
        this.db
          .query('UPDATE projects SET name = ?, model = ?, revision = ?, updated_at = ? WHERE id = ?')
          .run(model.title, json, revision, stamp, id);
        this.db
          .query(
            'INSERT INTO revisions (project_id, number, model, source, summary, label, started_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)'
          )
          .run(id, revision, json, meta.source, meta.summary, continuesBurst ? head.started_at : stamp, stamp);
        this.pruneRevisions(id);
        return this.getProject(id);
      })
      .immediate();
  }

  listRevisions(id: string): RevisionSummary[] {
    this.row(id);
    return this.db
      .query<RevisionRow, [string]>(
        'SELECT number, source, summary, label, started_at, created_at FROM revisions WHERE project_id = ? ORDER BY number DESC'
      )
      .all(id)
      .map((row) => ({
        number: row.number,
        source: row.source,
        summary: row.summary,
        label: row.label,
        createdAt: row.created_at
      }));
  }

  /**
   * Drop old unnamed revisions so history cannot grow without limit. The first revision (the
   * original import), every named revision, and the newest REVISION_WINDOW stay restorable.
   */
  private pruneRevisions(id: string): void {
    this.db
      .query(
        `DELETE FROM revisions
          WHERE project_id = ?
            AND label IS NULL
            AND number <> 1
            AND number <= (SELECT MAX(number) FROM revisions WHERE project_id = ?) - ?`
      )
      .run(id, id, REVISION_WINDOW);
  }

  /** The model as it stood at a revision that is still in the history. */
  getRevisionModel(id: string, number: number): Model {
    this.row(id);
    const row = this.db
      .query<{ model: string }, [string, number]>('SELECT model FROM revisions WHERE project_id = ? AND number = ?')
      .get(id, number);
    if (!row) {
      const known = this.listRevisions(id).map((revision) => revision.number);
      // History is bounded, so a missing number is usually one that was pruned rather than one
      // that never existed. Name the range instead of echoing ~100 numbers to a person or agent.
      const newest = known[0];
      const oldest = known[known.length - 1];
      const pruned = number > oldest && number < newest;
      const reason = pruned ? ` Revision ${number} was pruned from the history.` : '';
      throw new NotFoundError(
        `Project "${id}" has no revision ${number}.${reason} Available: ${oldest}-${newest} (${known.length} revisions).`
      );
    }
    return JSON.parse(row.model) as Model;
  }

  /** Make an earlier revision current again, as a new revision; nothing is discarded. */
  restoreRevision(id: string, number: number): Project {
    const model = this.getRevisionModel(id, number);
    return this.updateModel(id, { source: 'restore', summary: `Restored revision ${number}` }, () => model);
  }

  /** Name the current revision. A named revision is never merged into a later autosave burst. */
  labelCurrentRevision(id: string, label: string): RevisionSummary {
    const { revision } = this.row(id);
    this.db.query('UPDATE revisions SET label = ? WHERE project_id = ? AND number = ?').run(label, id, revision);
    return this.listRevisions(id).find((entry) => entry.number === revision)!;
  }

  createShareLink(id: string, viewRef?: string): ShareLink {
    const project = this.getProject(id);
    const link: ShareLink = {
      token: randomBytes(16).toString('hex'),
      projectId: id,
      viewId: viewRef === undefined ? null : findView(project.model, viewRef).id,
      createdAt: this.now().toISOString()
    };
    this.db
      .query('INSERT INTO share_links (token, project_id, view_id, created_at) VALUES (?, ?, ?, ?)')
      .run(link.token, link.projectId, link.viewId, link.createdAt);
    return link;
  }

  listShareLinks(id: string): ShareLink[] {
    this.row(id);
    return this.db
      .query<{ token: string; project_id: string; view_id: string | null; created_at: string }, [string]>(
        'SELECT token, project_id, view_id, created_at FROM share_links WHERE project_id = ? ORDER BY created_at, token'
      )
      .all(id)
      .map((row) => ({ token: row.token, projectId: row.project_id, viewId: row.view_id, createdAt: row.created_at }));
  }

  revokeShareLink(token: string): void {
    const { changes } = this.db.query('DELETE FROM share_links WHERE token = ?').run(token);
    if (changes === 0) throw new NotFoundError('Unknown share link.');
  }

  /** The project a share token grants read access to. */
  resolveShareLink(token: string): { project: Project; viewId: string | null } {
    const row = this.db
      .query<{ project_id: string; view_id: string | null }, [string]>(
        'SELECT project_id, view_id FROM share_links WHERE token = ?'
      )
      .get(token);
    if (!row) throw new NotFoundError('Unknown share link.');
    return { project: this.getProject(row.project_id), viewId: row.view_id };
  }
}
