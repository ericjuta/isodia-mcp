import { useCallback, useEffect, useState } from 'react';
import { api, type Revision, type ShareLink } from './api';
import { askConfirm, Snippet, When } from './ui';

/** Who made a revision, as the history shows it. An MCP client is an agent. */
const SOURCE_LABEL: Record<Revision['source'], string> = {
  editor: 'editor',
  mcp: 'agent',
  api: 'api',
  import: 'import',
  restore: 'restore'
};

/** Save an object URL under `filename`, then release it. */
function download(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function useAsync<T>(load: () => Promise<T>): { value: T | null; error: string | null; refresh(): void } {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    load().then(
      (loaded) => {
        setValue(loaded);
        setError(null);
      },
      (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure))
    );
  }, [load]);
  useEffect(refresh, [refresh]);
  return { value, error, refresh };
}

export function HistoryPanel(props: { projectId: string; revision: number; onRestored(): void }) {
  const { projectId, revision, onRestored } = props;
  // `revision` is a dependency so the list follows saves made while the panel is open.
  const { value: revisions, error, refresh } = useAsync(
    useCallback(() => api.listRevisions(projectId), [projectId, revision])
  );
  const [label, setLabel] = useState('');
  const [preview, setPreview] = useState<{ number: number; url: string } | null>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview]
  );

  const restore = async (number: number) => {
    const sure = await askConfirm({
      title: `Restore revision ${number}?`,
      body: 'It comes back as a new revision, so you can undo this.',
      confirm: 'Restore'
    });
    if (!sure) return;
    await api.restoreRevision(projectId, number);
    onRestored();
  };

  return (
    <section className="panel-body">
      <p className="hint">
        Every change is saved. The newest 100 revisions are kept, plus the original and any you name.
      </p>
      <form
        className="row"
        onSubmit={async (event) => {
          event.preventDefault();
          if (label.trim() === '') return;
          await api.saveCheckpoint(projectId, label.trim());
          setLabel('');
          refresh();
        }}
      >
        <input
          className="field"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Name this revision"
          aria-label="Checkpoint name"
          maxLength={100}
        />
        <button type="submit" className="btn">
          Save checkpoint
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {preview && (
        <figure className="preview">
          <img src={preview.url} alt={`Revision ${preview.number}`} />
          <figcaption className="mono">r{preview.number}</figcaption>
        </figure>
      )}
      <ol className="list">
        {(revisions ?? []).map((entry: Revision) => (
          <li key={entry.number} data-revision={entry.number} className={entry.number === revision ? 'current' : ''}>
            <span className="rev mono">r{entry.number}</span>
            <div className="list-main">
              <strong>{entry.label ?? entry.summary}</strong>
              <span className="meta">
                <span className={`badge badge-${entry.source}`}>{SOURCE_LABEL[entry.source]}</span>
                <When iso={entry.createdAt} />
              </span>
              {entry.label && <span className="meta">{entry.summary}</span>}
            </div>
            <div className="list-actions">
              <button
                type="button"
                className="btn quiet small"
                onClick={async () => setPreview({ number: entry.number, url: await api.revisionRenderUrl(projectId, entry.number, 640) })}
              >
                Preview
              </button>
              {entry.number !== revision && (
                <button type="button" className="btn quiet small" onClick={() => void restore(entry.number)}>
                  Restore
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function SharePanel(props: { projectId: string; viewId: string; viewName: string }) {
  const { projectId, viewId, viewName } = props;
  const { value: links, error, refresh } = useAsync(useCallback(() => api.listShares(projectId), [projectId]));
  const [copied, setCopied] = useState<string | null>(null);
  const urlOf = (link: ShareLink): string => `${window.location.origin}/s/${link.token}`;

  return (
    <section className="panel-body">
      <p className="hint">
        A share link opens a live, read-only copy. Anyone holding it can view the project without signing in, until you
        revoke it.
      </p>
      <button
        type="button"
        className="btn primary"
        onClick={async () => {
          await api.createShare(projectId, viewId);
          refresh();
        }}
      >
        Create link opening on “{viewName}”
      </button>
      {error && <p className="error">{error}</p>}
      <ul className="list plain">
        {(links ?? []).map((link) => (
          <li key={link.token}>
            <div className="list-main">
              <a className="link mono" href={urlOf(link)} target="_blank" rel="noreferrer">
                {urlOf(link)}
              </a>
              <span className="meta">
                Opens on {link.viewId ?? 'the first view'} · created <When iso={link.createdAt} />
              </span>
            </div>
            <div className="list-actions">
              <button
                type="button"
                className="btn quiet small"
                onClick={async () => {
                  await navigator.clipboard.writeText(urlOf(link));
                  setCopied(link.token);
                }}
              >
                {copied === link.token ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                className="btn quiet small"
                onClick={async () => {
                  await api.revokeShare(link.token);
                  refresh();
                }}
              >
                Revoke
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ExportPanel(props: { projectId: string; viewId: string }) {
  const { projectId, viewId } = props;
  return (
    <section className="panel-body">
      <p className="hint">Your diagrams are plain JSON in the Isoflow model format. Take them anywhere.</p>
      <div className="stack">
        <button
          type="button"
          className="btn"
          onClick={async () => download(await api.exportUrl(projectId), `${projectId}.json`)}
        >
          Download model JSON
        </button>
        <span className="meta">Complete on its own: the icons it uses are embedded.</span>
        <button
          type="button"
          className="btn"
          onClick={async () => download(await api.renderUrl(projectId, 2400, viewId), `${projectId}-${viewId}.png`)}
        >
          Download PNG of this view
        </button>
        <span className="meta">Rendered on the server, the same picture agents see.</span>
      </div>
    </section>
  );
}

export function AgentPanel(props: { projectId: string }) {
  const { value: info, error } = useAsync(useCallback(() => api.info(), []));
  const http = info && JSON.stringify({ mcpServers: { 'isodia': { type: 'http', url: info.mcpUrl } } }, null, 2);
  const [command, ...args] = info ? info.stdioCommand.split(' ') : [''];
  const stdio = info && JSON.stringify({ mcpServers: { 'isodia': { command, args } } }, null, 2);

  return (
    <section className="panel-body">
      <p className="hint">
        The MCP server lets a coding agent build, edit and render these diagrams. Changes it makes appear here within a
        couple of seconds.
      </p>
      {error && <p className="error">{error}</p>}
      {info && (
        <>
          <h3>Over HTTP</h3>
          <Snippet text={http ?? ''} />
          {info.tokenRequired && <p className="meta">Send the workspace token as an Authorization: Bearer header.</p>}
          <h3>Over stdio, on this machine</h3>
          <Snippet text={stdio ?? ''} />
          <h3>Try asking</h3>
          <Snippet
            text={`Use isodia to add a Redis cache to the "${props.projectId}" project and connect the API to it, then show me the result.`}
          />
          <p className="meta mono">server {info.version}</p>
        </>
      )}
    </section>
  );
}
