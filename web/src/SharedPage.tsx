import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Shown } from './Diagram';
import { Brand, Mark } from './ui';

const Diagram = lazy(() => import('./Diagram'));

const POLL_INTERVAL_MS = 3000;

/** A read-only, live copy of a project, reached through a share link. */
export function SharedPage({ token }: { token: string }) {
  const [name, setName] = useState('');
  const [shown, setShown] = useState<Shown | null>(null);
  const [failed, setFailed] = useState(false);
  const revision = useRef(0);
  /** The view the visitor is looking at, once they have picked one. */
  const chosen = useRef<string | null>(null);

  const load = useCallback(
    async (fit: boolean) => {
      try {
        const shared = await api.getShared(token);
        const wanted = chosen.current ?? shared.viewId;
        const view = shared.model.views.find((candidate) => candidate.id === wanted) ?? shared.model.views[0];
        revision.current = shared.revision;
        setName(shared.name);
        setShown({ model: shared.model, view: view.id, fit });
      } catch {
        setFailed(true);
      }
    },
    [token]
  );

  useEffect(() => {
    void load(true);
    const poll = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const remote = await api.getSharedRevision(token);
        if (remote.revision !== revision.current) await load(false);
      } catch {
        setFailed(true);
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(poll);
  }, [token, load]);

  if (failed) {
    return (
      <div className="empty">
        <Mark size={32} />
        <h1>This link is no longer available</h1>
        <p>It may have been revoked by the project's owner.</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="bar">
        <Brand />
        <span className="rule" />
        <span className="title">{name}</span>
        <nav className="tabs" aria-label="Views">
          {(shown?.model.views ?? []).map((view) => (
            <button
              type="button"
              key={view.id}
              className={view.id === shown?.view ? 'tab active' : 'tab'}
              onClick={() => {
                chosen.current = view.id;
                setShown((previous) => previous && { ...previous, view: view.id, fit: true });
              }}
            >
              {view.name}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <span className="status live">
          <span className="dot" />
          Live · read-only
        </span>
      </header>
      <div className="workspace">
        <main className="canvas">
          {shown && (
            <Suspense fallback={<div className="loading">Loading diagram…</div>}>
              <Diagram shown={shown} editable={false} />
            </Suspense>
          )}
        </main>
      </div>
    </div>
  );
}
