import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { htmlToText } from '../../src/core/text';
import type { Walkthrough } from '../../src/core/walkthrough';
import { Brand, Mark } from './ui';
import { registerWalkthroughTools } from './walkthrough-webmcp';

const Diagram = lazy(() => import('./Diagram'));

const stepFromLocation = () => new URLSearchParams(window.location.search).get('step');
const stepUrl = (path: string, step: string) => `${path}?${new URLSearchParams({ step })}`;
const stepHeadingId = 'walkthrough-step-heading';
const stepProgressId = 'walkthrough-step-progress';

function StepReader({ story, stepIndex, path, go, focusOnEntry }: {
  story: Walkthrough;
  stepIndex: number;
  path: string;
  go(event: MouseEvent<HTMLAnchorElement>, to: string): void;
  focusOnEntry: boolean;
}) {
  const step = story.steps[stepIndex];
  const previous = story.steps[stepIndex - 1];
  const next = story.steps[stepIndex + 1];
  const [viewId, setViewId] = useState(step.view);
  const [component, setComponent] = useState<string | null>(step.component ?? null);
  const [reset, setReset] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnEntry) heading.current?.focus({ preventScroll: true });
  }, [focusOnEntry]);
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
          <h2 id={stepHeadingId} ref={heading} tabIndex={-1} aria-describedby={stepProgressId}>{step.title}</h2>
          <p className="walkthrough-prose" data-testid="step-body">{step.body}</p>
          {(previous || next) && (
            <nav className="walkthrough-adjacent" aria-label="Adjacent steps">
              {previous && <a className="link" rel="prev" href={stepUrl(path, previous.id)} onClick={(event) => go(event, previous.id)}>Previous step</a>}
              {next && <a className="link" rel="next" href={stepUrl(path, next.id)} onClick={(event) => go(event, next.id)}>Next step</a>}
            </nav>
          )}
          {exploring && (
            <button type="button" className="btn" data-testid="return-to-step" onClick={() => {
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
              <button key={id} type="button" className="btn" data-view={id} aria-pressed={viewId === id} onClick={() => {
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
  const [{ wanted, focusOnEntry }, setNavigation] = useState(() => ({ wanted: stepFromLocation(), focusOnEntry: false }));
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
    const restore = () => setNavigation({ wanted: stepFromLocation(), focusOnEntry: true });
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  const navigate = useCallback((to: string) => {
    const href = stepUrl(path, to);
    if (href !== window.location.pathname + window.location.search) {
      // An iframe shares the containing tab's history. Do not put steps in the article's Back stack.
      if (embed) window.history.replaceState(null, '', href);
      else window.history.pushState(null, '', href);
    }
    setNavigation({ wanted: to, focusOnEntry: true });
  }, [embed, path]);

  const requestedIndex = story?.steps.findIndex((candidate) => candidate.id === wanted) ?? -1;
  const stepIndex = Math.max(0, requestedIndex);
  const step = story?.steps[stepIndex];
  const stepId = step?.id ?? '';
  const currentStep = useRef(stepId);
  useLayoutEffect(() => {
    currentStep.current = stepId;
  }, [stepId]);

  useEffect(() => {
    if (!story) return;
    return registerWalkthroughTools({ story, currentStepId: () => currentStep.current, goToStep: navigate });
  }, [story, navigate]);

  if (failed || !story || !step) return (
    <div className="empty" role="status">
      <Mark size={32} />
      <h1>{failed ? 'Walkthrough not available' : 'Loading walkthrough…'}</h1>
    </div>
  );

  const go = (event: MouseEvent<HTMLAnchorElement>, to: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };

  return (
    <main className="walkthrough" data-testid="walkthrough" data-embed={embed}>
      <a className="link walkthrough-skip" href={`#${stepHeadingId}`} onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        document.getElementById(stepHeadingId)?.focus();
      }}>Skip to step</a>
      <header className="walkthrough-header">
        <Brand compact={embed} />
        <h1>{story.title}</h1>
        <div className="walkthrough-links">
          {embed && <a className="link" href={stepUrl(base, step.id)} target="_blank" rel="noopener noreferrer">Open full page</a>}
          <a className="link" href={story.articleUrl} target={embed ? '_top' : undefined} rel="noopener noreferrer">Back to article</a>
        </div>
      </header>
      <nav className="walkthrough-steps" aria-label="Walkthrough steps">
        <p className="walkthrough-progress" id={stepProgressId}>Step {stepIndex + 1} of {story.steps.length}</p>
        <ol>{story.steps.map((entry, index) => (
          <li key={entry.id}>
            <a className="link" data-step={entry.id} href={stepUrl(path, entry.id)} aria-current={entry.id === step.id ? 'step' : undefined} onClick={(event) => go(event, entry.id)}>
              {index + 1}. {entry.title}
            </a>
          </li>
        ))}</ol>
      </nav>
      {wanted !== null && requestedIndex === -1 && <p className="walkthrough-fallback" role="status">That step is not available. Showing the first step.</p>}
      <StepReader key={step.id} story={story} stepIndex={stepIndex} path={path} go={go} focusOnEntry={focusOnEntry} />
    </main>
  );
}
