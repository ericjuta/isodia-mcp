import { lazy, Suspense, useState } from 'react';
import { slug, uniqueId } from '../../src/core/ids';
import { AgentPanel, ExportPanel, HistoryPanel, SharePanel } from './panels';
import { askConfirm, askText, Brand, Mark, Menu } from './ui';
import { type SaveState, useProjectSync } from './useProjectSync';

const Diagram = lazy(() => import('./Diagram'));

type Panel = 'history' | 'share' | 'export' | 'agent';

const PANELS: Record<Panel, { tab: string; title: string }> = {
  history: { tab: 'History', title: 'Revision history' },
  share: { tab: 'Share', title: 'Share' },
  export: { tab: 'Export', title: 'Export' },
  agent: { tab: 'Agent', title: 'Connect an agent' }
};

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Not saved'
};

export function ProjectPage({ projectId }: { projectId: string }) {
  const sync = useProjectSync(projectId);
  const [panel, setPanel] = useState<Panel | null>(null);

  if (sync.phase === 'missing') {
    return (
      <div className="empty">
        <Mark size={32} />
        <h1>Project not found</h1>
        <a className="link" href="/">
          Back to all projects
        </a>
      </div>
    );
  }

  const viewIds = sync.views.map((view) => view.id);
  const current = sync.views.find((view) => view.id === sync.viewId);

  const addView = async () => {
    const name = await askText({ title: 'New view', label: 'View name', confirm: 'Add view' });
    if (!name) return;
    const id = uniqueId(slug(name), viewIds);
    sync.edit(
      (model) => ({
        ...model,
        views: [...model.views, { id, name, items: [], connectors: [], rectangles: [], textBoxes: [] }]
      }),
      id
    );
  };

  const duplicateView = () => {
    if (!current) return;
    const name = `${current.name} copy`;
    const id = uniqueId(slug(name), viewIds);
    sync.edit((model) => {
      const source = model.views.find((view) => view.id === current.id);
      return source ? { ...model, views: [...model.views, { ...structuredClone(source), id, name }] } : model;
    }, id);
  };

  const renameView = async () => {
    if (!current) return;
    const name = await askText({ title: 'Rename view', label: 'View name', value: current.name, confirm: 'Rename' });
    if (!name || name === current.name) return;
    sync.edit((model) => ({
      ...model,
      views: model.views.map((view) => (view.id === current.id ? { ...view, name } : view))
    }));
  };

  const deleteView = async () => {
    if (!current) return;
    const sure = await askConfirm({
      title: `Delete the view “${current.name}”?`,
      body: 'You can bring it back from the history.',
      confirm: 'Delete view',
      danger: true
    });
    if (!sure) return;
    const remaining = viewIds.filter((id) => id !== current.id);
    sync.edit((model) => ({ ...model, views: model.views.filter((view) => view.id !== current.id) }), remaining[0]);
  };

  const renameProject = async () => {
    const title = await askText({ title: 'Rename project', label: 'Project name', value: sync.name, confirm: 'Rename' });
    if (title && title !== sync.name) sync.edit((model) => ({ ...model, title }));
  };

  const toggle = (next: Panel) => setPanel((open) => (open === next ? null : next));

  return (
    <div className="app">
      <header className="bar">
        <Brand href="/" compact />
        <button type="button" className="btn quiet title" onClick={() => void renameProject()} title="Rename project">
          {sync.name || 'Loading…'}
        </button>
        <span className="rule" />
        <nav className="tabs" aria-label="Views">
          {sync.views.map((view) => (
            <button
              type="button"
              key={view.id}
              className={view.id === sync.viewId ? 'tab active' : 'tab'}
              onClick={() => sync.selectView(view.id)}
            >
              {view.name}
            </button>
          ))}
        </nav>
        <div className="view-actions">
          <button
            type="button"
            className="btn quiet icon"
            onClick={() => void addView()}
            title="Add a view"
            aria-label="Add a view"
          >
            +
          </button>
          <Menu label="View actions">
            <button type="button" role="menuitem" className="btn quiet" onClick={() => void renameView()}>
              Rename view
            </button>
            <button type="button" role="menuitem" className="btn quiet" onClick={duplicateView}>
              Duplicate view
            </button>
            <button
              type="button"
              role="menuitem"
              className="btn quiet destructive"
              onClick={() => void deleteView()}
              disabled={sync.views.length < 2}
            >
              Delete view
            </button>
          </Menu>
        </div>
        <span className="spacer" />
        <span className={`status status-${sync.saveState}`} data-testid="save-state" data-revision={sync.revision}>
          <span className="dot" />
          {SAVE_LABEL[sync.saveState]} · <span className="mono">r{sync.revision}</span>
        </span>
        <div className="seg" role="group" aria-label="Panels">
          {(Object.keys(PANELS) as Panel[]).map((name) => (
            <button type="button" key={name} className="btn" aria-pressed={panel === name} onClick={() => toggle(name)}>
              {name === 'agent' && <span className="dot agent" />}
              {PANELS[name].tab}
            </button>
          ))}
        </div>
      </header>
      {sync.notice && (
        <div className="notice" role="status">
          {sync.notice}
          <button type="button" className="btn quiet small" onClick={sync.dismissNotice}>
            Dismiss
          </button>
        </div>
      )}
      <div className="workspace">
        <main className="canvas">
          {sync.shown && (
            <Suspense fallback={<div className="loading">Loading editor…</div>}>
              <Diagram shown={sync.shown} editable onChange={sync.onChange} />
            </Suspense>
          )}
        </main>
        {panel && (
          <aside className="panel">
            <header className="panel-head">
              <h2>{PANELS[panel].title}</h2>
              <button type="button" className="btn quiet icon" aria-label="Close panel" onClick={() => setPanel(null)}>
                ×
              </button>
            </header>
            {panel === 'history' && (
              <HistoryPanel projectId={projectId} revision={sync.revision} onRestored={() => void sync.reload()} />
            )}
            {panel === 'share' && <SharePanel projectId={projectId} viewId={sync.viewId} viewName={current?.name ?? ''} />}
            {panel === 'export' && <ExportPanel projectId={projectId} viewId={sync.viewId} />}
            {panel === 'agent' && <AgentPanel projectId={projectId} />}
          </aside>
        )}
      </div>
    </div>
  );
}
