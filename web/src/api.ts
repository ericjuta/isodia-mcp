import type { Model } from '../../src/core/types';
import { askText } from './ui';

export interface ProjectSummary {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project extends ProjectSummary {
  /** Stored form: custom icons only; catalog icons are added in the browser. */
  model: Model;
}

export interface Revision {
  number: number;
  source: 'editor' | 'mcp' | 'api' | 'import' | 'restore';
  summary: string;
  label: string | null;
  createdAt: string;
}

export interface ShareLink {
  token: string;
  projectId: string;
  viewId: string | null;
  createdAt: string;
}

export interface SharedProject {
  name: string;
  revision: number;
  viewId: string | null;
  model: Model;
}

export interface ServerInfo {
  version: string;
  mcpUrl: string;
  stdioCommand: string;
  tokenRequired: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const TOKEN_KEY = 'isodia-token';

/**
 * One prompt shared by every request that is waiting on a token. Without this, a page load fires
 * several API calls at once, all of them get 401, and the browser queues one prompt per call.
 */
let tokenPrompt: Promise<string | null> | null = null;

function requestToken(): Promise<string | null> {
  if (tokenPrompt === null) {
    tokenPrompt = Promise.resolve()
      .then(() =>
        askText({
          title: 'Access token',
          body: 'This workspace requires a token. It is kept in this browser.',
          label: 'Token',
          secret: true,
          confirm: 'Continue'
        })
      )
      .finally(() => {
        tokenPrompt = null;
      });
  }
  return tokenPrompt;
}

async function send(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === null ? {} : { authorization: `Bearer ${token}` })
    }
  });
  // Retry once with the token the user supplies. `retried` stops a wrong token from prompting
  // again forever: the second 401 becomes an ordinary error the page can show.
  if (response.status === 401 && !retried) {
    const entered = await requestToken();
    if (entered) {
      localStorage.setItem(TOKEN_KEY, entered.trim());
      return send(path, init, true);
    }
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body !== null && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : response.statusText;
    throw new ApiError(response.status, message);
  }
  return response;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await send(path, init)).json() as Promise<T>;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

/** Fetch a protected binary resource as an object URL the caller must revoke. */
async function objectUrl(path: string): Promise<string> {
  return URL.createObjectURL(await (await send(path)).blob());
}

const project = (id: string): string => `/api/projects/${encodeURIComponent(id)}`;

export const api = {
  info: () => json<ServerInfo>('/api/info'),
  listProjects: () => json<ProjectSummary[]>('/api/projects'),
  createProject: (name: string) => json<Project>('/api/projects', post({ name })),
  importProject: (model: unknown) => json<Project>('/api/projects', post({ model })),
  getProject: (id: string) => json<Project>(project(id)),
  getRevision: (id: string) => json<{ revision: number }>(`${project(id)}/revision`),
  saveModel: (id: string, model: Model, baseRevision: number) =>
    json<{ revision: number }>(`${project(id)}/model`, { method: 'PUT', body: JSON.stringify({ model, baseRevision }) }),
  deleteProject: (id: string) => send(project(id), { method: 'DELETE' }),
  listRevisions: (id: string) => json<Revision[]>(`${project(id)}/revisions`),
  restoreRevision: (id: string, number: number) => json<Project>(`${project(id)}/revisions/${number}/restore`, post({})),
  saveCheckpoint: (id: string, label: string) => json<Revision>(`${project(id)}/checkpoints`, post({ label })),
  listShares: (id: string) => json<ShareLink[]>(`${project(id)}/shares`),
  createShare: (id: string, view: string) => json<ShareLink>(`${project(id)}/shares`, post({ view })),
  revokeShare: (token: string) => send(`/api/shares/${token}`, { method: 'DELETE' }),
  getShared: (token: string) => json<SharedProject>(`/api/shared/${token}`),
  getSharedRevision: (token: string) => json<{ revision: number }>(`/api/shared/${token}/revision`),
  /** Picture of one view; the first view when `view` is omitted. */
  renderUrl: (id: string, width: number, view?: string) =>
    objectUrl(`${project(id)}/render?width=${width}${view === undefined ? '' : `&view=${encodeURIComponent(view)}`}`),
  revisionRenderUrl: (id: string, number: number, width: number) =>
    objectUrl(`${project(id)}/revisions/${number}/render?width=${width}`),
  exportUrl: (id: string) => objectUrl(`${project(id)}/export`)
};
