import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { connectorTiles, exists, regionBox, type Target, whatIsAt } from '../../src/core/hit';
import { textTiles } from '../../src/core/path';
import { applyOperations, DiagramError } from '../../src/core/model';
import type { Operation } from '../../src/core/operations';
import { HALF_H, HALF_W, PROJECTED_HEIGHT, PROJECTED_WIDTH, renderScene, type ScenePart, tileAt, tileCenter } from '../../src/core/render';
import { FONT_FAMILY } from '../../src/core/theme';
import type { Coords, Model, View } from '../../src/core/types';
import { IconPicker, Inspector, type Tool, Toolbar, ZoomBar } from './editor/chrome';

/** What the canvas should display. A new object replaces the canvas content, so replace it deliberately. */
export interface Shown {
  /** Stored form: custom icons only. */
  model: Model;
  view: string;
  /** Zoom and pan to fit the view; false keeps the user's current viewport. */
  fit: boolean;
}

interface Props {
  shown: Shown;
  editable: boolean;
  /** Receives the model after every edit made here. */
  onChange?: (model: Model) => void;
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

type Gesture =
  | { kind: 'pan'; startX: number; startY: number; camera: Camera; moved: boolean; clears: boolean }
  | { kind: 'move'; target: Target; from: Coords; origin: Coords }
  | { kind: 'resize'; region: string; fixed: Coords }
  | { kind: 'draw'; from: Coords };

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;
const FIT_MARGIN = 72;
const UNDO_DEPTH = 200;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const sameTile = (a: Coords, b: Coords): boolean => a.x === b.x && a.y === b.y;
const point = (x: number, y: number): string => {
  const at = tileCenter({ x, y });
  return `${at.x},${at.y}`;
};
/** Outline of a block of tiles on the ground plane, as polygon points. */
const outline = (lowX: number, highX: number, lowY: number, highY: number): string =>
  [point(lowX - 0.5, lowY - 0.5), point(highX + 0.5, lowY - 0.5), point(highX + 0.5, highY + 0.5), point(lowX - 0.5, highY + 0.5)].join(' ');

const viewOf = (model: Model, id: string): View => model.views.find((view) => view.id === id) ?? model.views[0];
/** The message of a refused edit, without the batch position an agent would want. */
const plain = (error: DiagramError): string => error.message.replace(/^Operation \d+ \([a-z_]+\): /, '');

function Layer({ parts, kind }: { parts: ScenePart[]; kind: string }) {
  return (
    <g>
      {parts.map((part) => (
        // The markup is our renderer's own output. Unchanged strings leave the DOM untouched, so
        // dragging one item does not redraw the others.
        <g key={part.id} {...{ [`data-${kind}`]: part.id }} dangerouslySetInnerHTML={{ __html: part.markup }} />
      ))}
    </g>
  );
}

/**
 * The canvas: our renderer's drawing of one view, with editing on top. It draws with the same
 * code that exports pictures and edits with the same operations agents send, so there is one
 * definition of what a diagram looks like and one of how it changes.
 */
export default function Diagram({ shown, editable, onChange }: Props) {
  const [model, setModel] = useState(shown.model);
  /** An edit in progress (a drag, a field being typed in): drawn, not yet recorded. */
  const [draft, setDraftState] = useState<Model | null>(null);
  /** The same draft, readable by a handler that runs before the next render. */
  const draftRef = useRef<Model | null>(null);
  const setDraft = useCallback((next: Model | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);
  const [selection, setSelection] = useState<Target | null>(null);
  /** The selection was just created here, so its first field takes focus. */
  const [fresh, setFresh] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<{ from: Coords; to: Coords } | null>(null);
  const [hover, setHover] = useState<Coords | null>(null);
  const [picker, setPicker] = useState<'add' | 'change' | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [message, setMessage] = useState<string | null>(null);
  /** Bumped whenever the model is replaced wholesale, so fields drop their own text. */
  const [epoch, setEpoch] = useState(0);

  const stage = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const committed = useRef(shown.model);
  const history = useRef<{ past: Model[]; future: Model[] }>({ past: [], future: [] });
  const gesture = useRef<Gesture | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const messageTimer = useRef<number | undefined>(undefined);

  const current = draft ?? model;
  const view = viewOf(current, shown.view);
  const selected = selection && exists(view, selection) ? selection : null;
  const scene = useMemo(() => renderScene(current, view), [current, view]);

  const flash = useCallback((text: string) => {
    setMessage(text);
    window.clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => setMessage(null), 3500);
  }, []);

  const fit = useCallback(() => {
    const box = stage.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const { bounds } = renderScene(committed.current, viewOf(committed.current, shown.view));
    const zoom = clamp(
      Math.min((box.width - FIT_MARGIN * 2) / (bounds.maxX - bounds.minX), (box.height - FIT_MARGIN * 2) / (bounds.maxY - bounds.minY)),
      MIN_ZOOM,
      1
    );
    setCamera({
      zoom,
      x: box.width / 2 - (zoom * (bounds.minX + bounds.maxX)) / 2,
      y: box.height / 2 - (zoom * (bounds.minY + bounds.maxY)) / 2
    });
  }, [shown.view]);

  // New content from outside (first load, another view, a change made elsewhere) replaces
  // everything held here, including the undo history: undoing across it would silently discard
  // someone else's work.
  useLayoutEffect(() => {
    committed.current = shown.model;
    history.current = { past: [], future: [] };
    gesture.current = null;
    setModel(shown.model);
    setDraft(null);
    setDrawing(null);
    setConnectFrom(null);
    setEpoch((value) => value + 1);
    if (shown.fit) {
      setSelection(null);
      fit();
    }
  }, [shown, fit]);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Record a new model as one undoable step and report it. */
  const record = useCallback(
    (next: Model) => {
      setDraft(null);
      if (JSON.stringify(next) === JSON.stringify(committed.current)) return;
      const { past } = history.current;
      past.push(committed.current);
      if (past.length > UNDO_DEPTH) past.shift();
      history.current.future = [];
      committed.current = next;
      setModel(next);
      onChange?.(next);
    },
    [onChange]
  );

  const attempt = useCallback(
    (operations: Operation[]): Model | null => {
      try {
        return applyOperations(committed.current, shown.view, operations).model;
      } catch (error) {
        if (error instanceof DiagramError) return null;
        throw error;
      }
    },
    [shown.view]
  );

  /** Apply operations as one recorded step; a refused edit is explained and changes nothing. */
  const run = useCallback(
    (operations: Operation[]): Model | null => {
      try {
        const next = applyOperations(committed.current, shown.view, operations).model;
        record(next);
        return next;
      } catch (error) {
        if (!(error instanceof DiagramError)) throw error;
        setDraft(null);
        flash(plain(error));
        return null;
      }
    },
    [shown.view, record, flash]
  );

  const preview = useCallback(
    (operations: Operation[]) => {
      const next = attempt(operations);
      if (next) setDraft(next);
    },
    [attempt]
  );

  const step = useCallback(
    (from: 'past' | 'future') => {
      const source = history.current[from];
      const next = source.pop();
      if (!next) return;
      history.current[from === 'past' ? 'future' : 'past'].push(committed.current);
      committed.current = next;
      setModel(next);
      setDraft(null);
      setEpoch((value) => value + 1);
      onChange?.(next);
    },
    [onChange]
  );

  /** Select whichever entry of `pool` the last edit added. */
  const selectAdded = (kind: Target['kind'], before: { id: string }[], after: { id: string }[] | undefined): void => {
    const known = new Set(before.map((entry) => entry.id));
    const added = (after ?? []).find((entry) => !known.has(entry.id));
    if (added) {
      setSelection({ kind, id: added.id });
      setFresh(true);
    }
  };

  const remove = useCallback(() => {
    if (!selected) return;
    const operation: Operation =
      selected.kind === 'item'
        ? { op: 'remove_item', item: selected.id }
        : selected.kind === 'connector'
          ? { op: 'remove_connector', connector: selected.id }
          : selected.kind === 'region'
            ? { op: 'remove_region', region: selected.id }
            : { op: 'remove_text', text: selected.id };
    run([operation]);
    setSelection(null);
  }, [selected, run]);

  const chooseTool = useCallback((next: Tool) => {
    setTool(next);
    setConnectFrom(null);
    setDrawing(null);
    setPicker(null);
  }, []);

  const zoomBy = useCallback((factor: number, about?: Coords) => {
    setCamera((was) => {
      const box = stage.current?.getBoundingClientRect();
      const anchor = about ?? { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 };
      const zoom = clamp(was.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const scale = zoom / was.zoom;
      return { zoom, x: anchor.x - (anchor.x - was.x) * scale, y: anchor.y - (anchor.y - was.y) * scale };
    });
  }, []);

  // The wheel pans and, with Ctrl or Cmd (which is also what a trackpad pinch sends), zooms about
  // the pointer. Registered by hand because the page must not scroll or zoom underneath.
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const box = element.getBoundingClientRect();
        zoomBy(Math.exp(-event.deltaY * 0.0022), { x: event.clientX - box.left, y: event.clientY - box.top });
      } else {
        setCamera((was) => ({ ...was, x: was.x - event.deltaX, y: was.y - event.deltaY }));
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  useEffect(() => {
    if (!editable) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, dialog, [contenteditable]')) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        step(event.shiftKey ? 'future' : 'past');
      } else if (command || event.altKey) {
        return;
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        remove();
      } else if (event.key === 'Escape') {
        if (picker) setPicker(null);
        else if (tool !== 'select' || connectFrom) chooseTool('select');
        else setSelection(null);
      } else if (event.key.toLowerCase() === 'v') chooseTool('select');
      else if (event.key.toLowerCase() === 'c') chooseTool('connect');
      else if (event.key.toLowerCase() === 'r') chooseTool('region');
      else if (event.key.toLowerCase() === 't') chooseTool('text');
      else if (event.key.toLowerCase() === 'i') setPicker('add');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editable, step, remove, picker, tool, connectFrom, chooseTool]);

  const tileUnder = (event: { clientX: number; clientY: number }): Coords => {
    const box = svg.current!.getBoundingClientRect();
    const { x, y, zoom } = cameraRef.current;
    return tileAt({ x: (event.clientX - box.left - x) / zoom, y: (event.clientY - box.top - y) / zoom });
  };

  /** Begin panning. With `clears`, a press released without moving drops the selection. */
  const startPan = (event: ReactPointerEvent, clears: boolean): void => {
    gesture.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, camera: cameraRef.current, moved: false, clears };
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0 && event.button !== 1) return;
    // Leaving a field records what was typed in it, before this press changes anything else.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    event.currentTarget.setPointerCapture(event.pointerId);
    setPicker(null);
    setFresh(false);
    const tile = tileUnder(event);
    const base = viewOf(committed.current, shown.view);
    const target = whatIsAt(base, tile);

    if (event.button === 1) return startPan(event, false);

    if (!editable) {
      setSelection(target?.kind === 'item' ? target : null);
      return startPan(event, false);
    }

    if (tool === 'connect') {
      if (target?.kind !== 'item') {
        setConnectFrom(null);
      } else if (connectFrom === null || connectFrom === target.id) {
        setConnectFrom(connectFrom === target.id ? null : target.id);
      } else {
        const next = run([{ op: 'connect', from: connectFrom, to: target.id }]);
        if (next) selectAdded('connector', base.connectors ?? [], viewOf(next, shown.view).connectors);
        chooseTool('select');
      }
      return;
    }

    if (tool === 'text') {
      const next = run([{ op: 'add_text', content: 'Text', tile }]);
      if (next) selectAdded('text', base.textBoxes ?? [], viewOf(next, shown.view).textBoxes);
      chooseTool('select');
      return;
    }

    if (tool === 'region') {
      gesture.current = { kind: 'draw', from: tile };
      setDrawing({ from: tile, to: tile });
      return;
    }

    // A selected region is resized by its corner tiles, unless an item stands on one.
    if (selected?.kind === 'region' && target?.kind !== 'item') {
      const region = (base.rectangles ?? []).find((entry) => entry.id === selected.id);
      if (region) {
        const box = regionBox(region);
        const onX = tile.x === box.lowX ? box.highX : tile.x === box.highX ? box.lowX : null;
        const onY = tile.y === box.lowY ? box.highY : tile.y === box.highY ? box.lowY : null;
        if (onX !== null && onY !== null) {
          gesture.current = { kind: 'resize', region: region.id, fixed: { x: onX, y: onY } };
          return;
        }
      }
    }

    if (!target) {
      // Released without moving, this press clears the selection; moved, it pans.
      return startPan(event, true);
    }
    setSelection(target);
    const origin =
      target.kind === 'item'
        ? base.items.find((entry) => entry.id === target.id)!.tile
        : target.kind === 'text'
          ? (base.textBoxes ?? []).find((entry) => entry.id === target.id)!.tile
          : tile;
    if (target.kind !== 'connector') gesture.current = { kind: 'move', target, from: tile, origin };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const tile = tileUnder(event);
    setHover((was) => (was && sameTile(was, tile) ? was : tile));
    const active = gesture.current;
    if (!active) return;

    if (active.kind === 'pan') {
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;
      if (!active.moved && Math.hypot(dx, dy) < 4) return;
      active.moved = true;
      setCamera({ ...active.camera, x: active.camera.x + dx, y: active.camera.y + dy });
    } else if (active.kind === 'draw') {
      setDrawing({ from: active.from, to: tile });
    } else if (active.kind === 'resize') {
      preview([
        {
          op: 'update_region',
          region: active.region,
          from: { x: Math.min(active.fixed.x, tile.x), y: Math.min(active.fixed.y, tile.y) },
          to: { x: Math.max(active.fixed.x, tile.x), y: Math.max(active.fixed.y, tile.y) }
        }
      ]);
    } else {
      const by = { x: tile.x - active.from.x, y: tile.y - active.from.y };
      if (by.x === 0 && by.y === 0) return setDraft(null);
      const to = { x: active.origin.x + by.x, y: active.origin.y + by.y };
      // A refused position (a taken tile) leaves the last good one showing.
      if (active.target.kind === 'item') preview([{ op: 'move_item', item: active.target.id, tile: to }]);
      else if (active.target.kind === 'text') preview([{ op: 'update_text', text: active.target.id, tile: to }]);
      else if (active.target.kind === 'region') preview([{ op: 'move_region', region: active.target.id, by }]);
    }
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const active = gesture.current;
    gesture.current = null;
    if (!active) return;
    if (active.kind === 'pan') {
      if (!active.moved && active.clears) setSelection(null);
    } else if (active.kind === 'draw') {
      const to = tileUnder(event);
      setDrawing(null);
      const before = viewOf(committed.current, shown.view).rectangles ?? [];
      const next = run([{ op: 'add_region', from: active.from, to }]);
      if (next) selectAdded('region', before, viewOf(next, shown.view).rectangles);
      chooseTool('select');
    } else if (draftRef.current) {
      record(draftRef.current);
    }
  };

  const addItem = (icon: string): void => {
    setPicker(null);
    const base = viewOf(committed.current, shown.view);
    // An empty view starts where the user is looking; otherwise the item lands beside the last one.
    const centre = tileAt({
      x: (size.width / 2 - cameraRef.current.x) / cameraRef.current.zoom,
      y: (size.height / 2 - cameraRef.current.y) / cameraRef.current.zoom
    });
    const next = run([{ op: 'add_item', name: 'New item', icon, ...(base.items.length === 0 ? { tile: centre } : {}) }]);
    if (!next) return;
    const items = viewOf(next, shown.view).items;
    selectAdded('item', base.items, items);
    // Bring the new item into sight if it landed outside the window.
    const placed = items.find((entry) => !base.items.some((old) => old.id === entry.id));
    if (placed) {
      const at = tileCenter(placed.tile);
      const { x, y, zoom } = cameraRef.current;
      const screen = { x: at.x * zoom + x, y: at.y * zoom + y };
      if (screen.x < 80 || screen.x > size.width - 80 || screen.y < 120 || screen.y > size.height - 80) {
        setCamera({ zoom, x: size.width / 2 - at.x * zoom, y: size.height / 2 - at.y * zoom });
      }
    }
  };

  const changeIcon = (icon: string): void => {
    setPicker(null);
    if (selected?.kind === 'item') run([{ op: 'update_item', item: selected.id, icon }]);
  };

  // Overlay: what is selected, what is under the pointer, and what a gesture is about to make.
  const selectedOutline = ((): string | null => {
    if (!selected) return null;
    if (selected.kind === 'item') {
      const item = view.items.find((entry) => entry.id === selected.id)!;
      return outline(item.tile.x, item.tile.x, item.tile.y, item.tile.y);
    }
    if (selected.kind === 'region') {
      const box = regionBox((view.rectangles ?? []).find((entry) => entry.id === selected.id)!);
      return outline(box.lowX, box.highX, box.lowY, box.highY);
    }
    if (selected.kind === 'text') {
      const tiles = textTiles((view.textBoxes ?? []).find((entry) => entry.id === selected.id)!);
      const xs = tiles.map((tile) => tile.x);
      const ys = tiles.map((tile) => tile.y);
      return outline(Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys));
    }
    return null;
  })();
  const selectedPath =
    selected?.kind === 'connector'
      ? connectorTiles((view.connectors ?? []).find((entry) => entry.id === selected.id)!, view)
          .map((tile) => point(tile.x, tile.y))
          .join(' ')
      : null;
  const handles =
    editable && selected?.kind === 'region'
      ? (() => {
          const box = regionBox((view.rectangles ?? []).find((entry) => entry.id === selected.id)!);
          return [
            { x: box.lowX, y: box.lowY },
            { x: box.highX, y: box.lowY },
            { x: box.highX, y: box.highY },
            { x: box.lowX, y: box.highY }
          ].map(tileCenter);
        })()
      : [];
  const connectSource = connectFrom ? view.items.find((entry) => entry.id === connectFrom) : undefined;
  const world = {
    x: -camera.x / camera.zoom,
    y: -camera.y / camera.zoom,
    width: size.width / camera.zoom,
    height: size.height / camera.zoom
  };

  return (
    <div className={`stage tool-${editable ? tool : 'read'}`} ref={stage}>
      <svg
        ref={svg}
        className="stage-svg"
        data-testid="stage"
        data-zoom={camera.zoom}
        data-pan-x={camera.x}
        data-pan-y={camera.y}
        fontFamily={FONT_FAMILY}
        // The canvas is not focusable. Without this, the browser moves focus to the page after
        // a press, taking it from a field that the press itself just opened (a new label).
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          gesture.current = null;
          setDraft(null);
          setDrawing(null);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <pattern id="tile-grid" x={-HALF_W} y={-HALF_H} width={PROJECTED_WIDTH} height={PROJECTED_HEIGHT} patternUnits="userSpaceOnUse">
            <path className="grid-line" d={`M0 ${HALF_H}L${HALF_W} 0L${PROJECTED_WIDTH} ${HALF_H}L${HALF_W} ${PROJECTED_HEIGHT}Z`} />
          </pattern>
        </defs>
        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
          {editable && <rect {...world} fill="url(#tile-grid)" />}
          <Layer parts={scene.regions} kind="region" />
          <Layer parts={scene.connectors} kind="connector" />
          <Layer parts={scene.texts} kind="text" />
          <Layer parts={scene.connectorLabels} kind="connector-label" />
          <Layer parts={scene.items} kind="item" />
          <g className="overlay">
            {editable && hover && !gesture.current && <polygon className="hover" points={outline(hover.x, hover.x, hover.y, hover.y)} />}
            {selectedOutline && <polygon className="selected" points={selectedOutline} />}
            {selectedPath && <polyline className="selected line" points={selectedPath} />}
            {handles.map((at, index) => (
              <circle key={index} className="handle" cx={at.x} cy={at.y} r={9 / camera.zoom} />
            ))}
            {drawing && (
              <polygon
                className="pending"
                points={outline(
                  Math.min(drawing.from.x, drawing.to.x),
                  Math.max(drawing.from.x, drawing.to.x),
                  Math.min(drawing.from.y, drawing.to.y),
                  Math.max(drawing.from.y, drawing.to.y)
                )}
              />
            )}
            {connectSource && (
              <>
                <polygon className="selected" points={outline(connectSource.tile.x, connectSource.tile.x, connectSource.tile.y, connectSource.tile.y)} />
                {hover && <polyline className="pending" points={`${point(connectSource.tile.x, connectSource.tile.y)} ${point(hover.x, hover.y)}`} />}
              </>
            )}
          </g>
        </g>
      </svg>

      {editable && (
        <Toolbar
          tool={tool}
          onTool={chooseTool}
          adding={picker === 'add'}
          onAddItem={() => setPicker((open) => (open === 'add' ? null : 'add'))}
          canUndo={history.current.past.length > 0}
          canRedo={history.current.future.length > 0}
          onUndo={() => step('past')}
          onRedo={() => step('future')}
          onTidy={() => run([{ op: 'auto_layout' }]) && window.requestAnimationFrame(fit)}
        />
      )}
      {editable && tool !== 'select' && (
        <p className="tool-hint" role="status">
          {tool === 'connect'
            ? connectFrom
              ? 'Now click the item it leads to.'
              : 'Click the item the line starts from.'
            : tool === 'region'
              ? 'Drag across the tiles the region should cover.'
              : 'Click the tile the text starts on.'}{' '}
          <span className="aside">Esc cancels.</span>
        </p>
      )}
      {picker && (
        <IconPicker
          model={current}
          title={picker === 'add' ? 'Add an item' : 'Change icon'}
          onPick={picker === 'add' ? addItem : changeIcon}
          onClose={() => setPicker(null)}
        />
      )}
      {selected && (
        <Inspector
          key={`${selected.kind}:${selected.id}:${epoch}`}
          model={current}
          view={view}
          selected={selected}
          editable={editable}
          fresh={fresh}
          preview={preview}
          commit={run}
          onPickIcon={() => setPicker('change')}
          onDelete={remove}
        />
      )}
      {editable && view.items.length === 0 && (view.rectangles ?? []).length === 0 && (view.textBoxes ?? []).length === 0 && !picker && (
        <div className="stage-empty">
          <p>This view is empty.</p>
          <button type="button" className="btn primary" onClick={() => setPicker('add')}>
            Add the first item
          </button>
          <p className="hint">Or connect an agent and ask it to draw.</p>
        </div>
      )}
      {message && (
        <p className="stage-message" role="alert">
          {message}
        </p>
      )}
      <ZoomBar zoom={camera.zoom} onZoom={(factor) => zoomBy(factor)} onFit={fit} />
    </div>
  );
}
