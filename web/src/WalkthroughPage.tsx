import { lazy, Suspense, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { htmlToText } from '../../src/core/text';
import type { Walkthrough } from '../../src/core/walkthrough';
import { Brand, Mark } from './ui';

const Diagram = lazy(() => import('./Diagram'));

const stepFromLocation = () => new URLSearchParams(window.location.search).get('step');
const stepUrl = (path: string, step: string) => `${path}?${new URLSearchParams({ step })}`;

type Step = Walkthrough['steps'][number];

function StepReader({ story, step }: { story: Walkthrough; step: Step }) {
  const [viewId, setViewId] = useState(step.view);
  const [component, setComponent] = useState<string | null>(step.component ?? null);
  const [reset, setReset] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const model = story.model;
  const view = model.views.find((candidate) => candidate.id === viewId)!;
  const items = useMemo(() => {
    const byId = new Map(model.items.map((item) => [item.id, item]));
    return view.items.map(({ id }) => byId.get(id)!);
  }, [model, view]);
  const selected = items.find((item) => item.id === component);
  const notes = htmlToText(selected?.description ?? '');
  const shown = useMemo(() => ({ model, view: viewId, fit: true }), [model, viewId]);
  const exploring = viewId !== step.view || component !== (step.component ?? null);

  return (
    <div className="walkthrough-workspace">
      <section className="walkthrough-rail" aria-label="Walkthrough step and details">
        <div className="walkthrough-section">
          <h2 ref={heading} tabIndex={-1}>{step.title}</h2>
          <p className="walkthrough-prose" data-testid="step-body">{step.body}</p>
          {exploring && (
            <button type="button" className="btn" onClick={() => {
              setViewId(step.view);
              setComponent(step.component ?? null);
              setReset((value) => value + 1);
              heading.current?.focus({ preventScroll: true });
            }}>Return to step</button>
          )}
        </div>
        <div className="walkthrough-section">
          <h3>Explore this diagram</h3>
          <nav aria-label="Published views" className="walkthrough-views">
            {model.views.map(({ id, name }) => (
              <button key={id} type="button" className="btn" aria-pressed={viewId === id} onClick={() => {
                if (id === viewId) return;
                setViewId(id);
                setComponent(null);
              }}>{name || id}</button>
            ))}
          </nav>
          <label className="walkthrough-component">
            Component
            <select className="field" aria-label="Component" value={component ?? ''} onChange={(event) => setComponent(event.target.value || null)}>
              <option value="">Choose a component</option>
              {items.map(({ id, name }) => <option key={id} value={id}>{name || id}</option>)}
            </select>
          </label>
          <div className="walkthrough-details" aria-live="polite" data-testid="component-notes">
            {selected ? <>
              <h3>{selected.name || selected.id}</h3>
              <p className="walkthrough-prose">{notes || 'No notes for this component.'}</p>
            </> : <p>Choose a component here or on the diagram to read its notes.</p>}
          </div>
        </div>
      </section>
      <section className="walkthrough-canvas canvas" aria-label={`Diagram: ${view.name || view.id}`}>
        <Suspense fallback={<div className="loading">Loading diagram…</div>}>
          <Diagram key={reset} shown={shown} editable={false} readerSelection={{ component, onSelect: setComponent }} />
        </Suspense>
      </section>
    </div>
  );
}

export function WalkthroughPage({ id, embed }: { id: string; embed: boolean }) {
  const [story, setStory] = useState<Walkthrough | null>(null);
  const [failed, setFailed] = useState(false);
  const [wanted, setWanted] = useState(stepFromLocation);
  const base = `/w/${encodeURIComponent(id)}`;
  const path = embed ? `${base}/embed` : base;

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/walkthroughs/${encodeURIComponent(id)}`, { signal: abort.signal });
        if (!response.ok) throw new Error('Walkthrough not available.');
        const snapshot: Walkthrough = await response.json();
        if (abort.signal.aborted) return;
        document.title = `${snapshot.title} · isodia`;
        setStory(snapshot);
      } catch {
        if (!abort.signal.aborted) setFailed(true);
      }
    })();
    return () => abort.abort();
  }, [id]);

  useEffect(() => {
    const restore = () => setWanted(stepFromLocation());
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  if (failed || !story) return (
    <div className="empty" role="status">
      <Mark size={32} />
      <h1>{failed ? 'Walkthrough not available' : 'Loading walkthrough…'}</h1>
    </div>
  );

  const requested = story.steps.find((candidate) => candidate.id === wanted);
  const step = requested ?? story.steps[0];
  const go = (event: MouseEvent<HTMLAnchorElement>, to: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const href = stepUrl(path, to);
    if (href !== window.location.pathname + window.location.search) window.history.pushState(null, '', href);
    setWanted(to);
  };

  return (
    <main className="walkthrough" data-testid="walkthrough" data-embed={embed}>
      <header className="walkthrough-header">
        <Brand compact={embed} />
        <h1>{story.title}</h1>
        <div className="walkthrough-links">
          {embed && <a className="link" href={stepUrl(base, step.id)} target="_blank" rel="noopener noreferrer">Open full page</a>}
          <a className="link" href={story.articleUrl} target={embed ? '_blank' : undefined} rel="noopener noreferrer">Back to article</a>
        </div>
      </header>
      <nav className="walkthrough-steps" aria-label="Walkthrough steps">
        <ol>{story.steps.map((entry, index) => (
          <li key={entry.id}>
            <a className="link" data-step={entry.id} href={stepUrl(path, entry.id)} aria-current={entry.id === step.id ? 'step' : undefined} onClick={(event) => go(event, entry.id)}>
              {index + 1}. {entry.title}
            </a>
          </li>
        ))}</ol>
      </nav>
      {wanted !== null && !requested && <p className="walkthrough-fallback" role="status">That step is not available. Showing the first step.</p>}
      <StepReader key={step.id} story={story} step={step} />
    </main>
  );
}
