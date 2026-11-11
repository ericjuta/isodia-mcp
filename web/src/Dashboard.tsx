import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ProjectSummary } from './api';
import { askConfirm, askText, Brand, When } from './ui';

/** Server-rendered picture of a project's first view. */
function Thumbnail({ project }: { project: ProjectSummary }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let created: string | null = null;
    api.renderUrl(project.id, 720).then(
      (objectUrl) => {
        created = objectUrl;
        if (live) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      },
      () => undefined
    );
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
    // The revision changes whenever the picture would.
  }, [project.id, project.revision]);

  return <div className="thumb">{url && <img src={url} alt="" />}</div>;
}

export function Dashboard() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const report = (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure));
  const refresh = useCallback(() => {
    api.listProjects().then(setProjects, report);
  }, []);
  useEffect(refresh, [refresh]);

  const create = async () => {
    const name = await askText({ title: 'New project', label: 'Project name', confirm: 'Create' });
    if (!name) return;
    try {
      const project = await api.createProject(name);
      window.location.assign(`/p/${project.id}`);
    } catch (failure) {
      report(failure);
    }
  };

  const importFile = async (selected: File | undefined) => {
    if (!selected) return;
    try {
      const project = await api.importProject(JSON.parse(await selected.text()));
      window.location.assign(`/p/${project.id}`);
    } catch (failure) {
      report(failure);
    }
  };

  const remove = async (project: ProjectSummary) => {
    const sure = await askConfirm({
      title: `Delete “${project.name}”?`,
      body: 'Its history and share links go with it. This cannot be undone.',
      confirm: 'Delete project',
      danger: true
    });
    if (!sure) return;
    try {
      await api.deleteProject(project.id);
      refresh();
    } catch (failure) {
      report(failure);
    }
  };

  return (
    <div className="dashboard">
      <header className="masthead">
        <Brand />
        <div className="row">
          <button type="button" className="btn quiet" onClick={() => file.current?.click()}>
            Import JSON
          </button>
          <button type="button" className="btn primary" onClick={() => void create()}>
            New project
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
        </div>
      </header>
      <section className="dashboard-head">
        <h1>
          Projects
          {projects && projects.length > 0 && <span className="mono">{projects.length}</span>}
        </h1>
        <p>Isometric architecture diagrams that you and your agents draw together, with every revision kept.</p>
        {error && <p className="error">{error}</p>}
      </section>
      {projects?.length === 0 && (
        <div className="blank">
          <strong>Nothing drawn yet</strong>
          <span>Start a project here, or ask a connected agent to build one.</span>
          <button type="button" className="btn primary" onClick={() => void create()}>
            New project
          </button>
        </div>
      )}
      <ul className="cards">
        {(projects ?? []).map((project) => (
          <li key={project.id} className="card">
            <a className="card-open" href={`/p/${project.id}`}>
              <Thumbnail project={project} />
              <strong>{project.name}</strong>
            </a>
            <div className="card-foot">
              <span className="meta">
                <span className="mono">r{project.revision}</span>
                <When iso={project.updatedAt} />
              </span>
              <button type="button" className="btn quiet small" onClick={() => void remove(project)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      <footer className="credit">
        MIT licensed. Built on the{' '}
        <a className="link" href="https://github.com/markmanx/isoflow" rel="noreferrer">
          Isoflow
        </a>{' '}
        editor, © 2023 Mark Mankarious. Icon artwork by AWS, Microsoft, Google and the Kubernetes project.
      </footer>
    </div>
  );
}
