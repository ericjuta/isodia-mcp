import { useEffect, useMemo, useRef, useState } from 'react';
import type { Target } from '../../../src/core/hit';
import { catalogIcon, resolveIcon, searchIcons } from '../../../src/core/icons';
import { colorName } from '../../../src/core/model';
import type { Operation } from '../../../src/core/operations';
import { htmlToText } from '../../../src/core/text';
import { PALETTE } from '../../../src/core/theme';
import { CONNECTOR_STYLES, type ConnectorStyle, type Model, type View } from '../../../src/core/types';

export type Tool = 'select' | 'connect' | 'region' | 'text';

const TOOLS: { tool: Tool; label: string; key: string; hint: string }[] = [
  { tool: 'select', label: 'Select', key: 'V', hint: 'Select, move and pan' },
  { tool: 'connect', label: 'Connect', key: 'C', hint: 'Click one item, then another' },
  { tool: 'region', label: 'Region', key: 'R', hint: 'Drag out a region' },
  { tool: 'text', label: 'Text', key: 'T', hint: 'Click a tile to write on it' }
];

/** The tools, in words. A word is read once; a pictogram is guessed every time. */
export function Toolbar(props: {
  tool: Tool;
  onTool(tool: Tool): void;
  onAddItem(): void;
  adding: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onTidy(): void;
}) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Editing tools">
      <div className="seg" role="group" aria-label="Tool">
        {TOOLS.map(({ tool, label, key, hint }) => (
          <button
            type="button"
            key={tool}
            className="btn"
            aria-pressed={props.tool === tool}
            title={`${hint} (${key})`}
            onClick={() => props.onTool(tool)}
          >
            {label}
          </button>
        ))}
      </div>
      <button type="button" className="btn" aria-expanded={props.adding} title="Add an item (I)" onClick={props.onAddItem}>
        Add item
      </button>
      <span className="rule" />
      <button type="button" className="btn quiet" disabled={!props.canUndo} title="Undo (Ctrl+Z)" onClick={props.onUndo}>
        Undo
      </button>
      <button type="button" className="btn quiet" disabled={!props.canRedo} title="Redo (Ctrl+Shift+Z)" onClick={props.onRedo}>
        Redo
      </button>
      <span className="rule" />
      <button type="button" className="btn quiet" title="Lay the whole view out again" onClick={props.onTidy}>
        Tidy
      </button>
    </div>
  );
}

export function ZoomBar(props: { zoom: number; onZoom(factor: number): void; onFit(): void }) {
  return (
    <div className="zoombar" role="group" aria-label="Zoom">
      <button type="button" className="btn quiet icon" aria-label="Zoom out" title="Zoom out" onClick={() => props.onZoom(1 / 1.25)}>
        −
      </button>
      <span className="mono zoom-value">{Math.round(props.zoom * 100)}%</span>
      <button type="button" className="btn quiet icon" aria-label="Zoom in" title="Zoom in" onClick={() => props.onZoom(1.25)}>
        +
      </button>
      <button type="button" className="btn quiet" title="Fit the view to the window" onClick={props.onFit}>
        Fit
      </button>
    </div>
  );
}

/** Choose an icon. Lists the project's own icons first, then the bundled set, filtered by search. */
export function IconPicker(props: { model: Model; title: string; onPick(icon: string): void; onClose(): void }) {
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);

  const icons = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const own = props.model.icons
      .filter((icon) => wanted === '' || icon.id.toLowerCase().includes(wanted) || icon.name.toLowerCase().includes(wanted))
      .map((icon) => ({ id: icon.id, name: icon.name, url: icon.url }));
    const taken = new Set(own.map((icon) => icon.id));
    const bundled = searchIcons(query, { limit: 200 })
      .filter((icon) => !taken.has(icon.id))
      .map((icon) => ({ id: icon.id, name: icon.name, url: catalogIcon(icon.id)?.url ?? '' }));
    return [...own, ...bundled];
  }, [query, props.model.icons]);

  return (
    <div
      className="picker"
      role="dialog"
      aria-label={props.title}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          props.onClose();
        }
      }}
    >
      <div className="picker-head">
        <input
          ref={field}
          className="field"
          type="search"
          aria-label="Search icons"
          placeholder="Search icons: database, queue, user…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && icons.length > 0) props.onPick(icons[0].id);
          }}
        />
        <button type="button" className="btn quiet icon" aria-label="Close" onClick={props.onClose}>
          ×
        </button>
      </div>
      {icons.length === 0 ? (
        <p className="hint picker-empty">No icon matches “{query.trim()}”. Try a plainer word.</p>
      ) : (
        <div className="picker-grid">
          {icons.map((icon) => (
            <button type="button" key={icon.id} className="picker-icon" data-icon={icon.id} title={icon.id} onClick={() => props.onPick(icon.id)}>
              <img src={icon.url} alt="" draggable={false} />
              <span>{icon.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A text control that shows its edit on the canvas while typing and records it once, on leaving
 * the field. It keeps its own text so the model's normalised form never fights the caret.
 */
function Draft(props: {
  label: string;
  value: string;
  multiline?: boolean;
  autoFocus?: boolean;
  onPreview(text: string): void;
  onCommit(text: string): void;
}) {
  const [text, setText] = useState(props.value);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    if (props.autoFocus) field.current?.select();
    // Only on mount: the inspector remounts this field when the selection changes.
  }, []);

  const shared = {
    ref: field,
    value: text,
    'aria-label': props.label,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setText(event.target.value);
      props.onPreview(event.target.value);
    },
    onBlur: () => props.onCommit(text)
  };
  return (
    <label className="prop">
      <span className="prop-label">{props.label}</span>
      {props.multiline ? (
        <textarea className="field area" rows={3} {...shared} />
      ) : (
        <input
          className="field"
          type="text"
          maxLength={100}
          {...shared}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      )}
    </label>
  );
}

function Swatches(props: { label: string; names: readonly string[]; current: string; onPick(name: string): void }) {
  return (
    <div className="prop">
      <span className="prop-label">{props.label}</span>
      <div className="swatches" role="group" aria-label={props.label}>
        {props.names.map((name) => (
          <button
            type="button"
            key={name}
            className="swatch"
            aria-label={name}
            aria-pressed={props.current === name}
            title={name}
            style={{ background: PALETTE.find((entry) => entry.name === name)?.value }}
            onClick={() => props.onPick(name)}
          />
        ))}
      </div>
    </div>
  );
}

function Choice<T extends string>(props: { label: string; options: { value: T; label: string }[]; current: T; onPick(value: T): void }) {
  return (
    <div className="prop">
      <span className="prop-label">{props.label}</span>
      <div className="seg" role="group" aria-label={props.label}>
        {props.options.map((option) => (
          <button
            type="button"
            key={option.value}
            className="btn small"
            aria-pressed={props.current === option.value}
            onClick={() => props.onPick(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const WASHES = PALETTE.filter((entry) => entry.name !== 'slate').map((entry) => entry.name);
const LINE_COLORS = ['slate', ...WASHES];
const LINE_STYLES: { value: ConnectorStyle; label: string }[] = CONNECTOR_STYLES.map((value) => ({
  value,
  label: value === 'SOLID' ? 'Solid' : value === 'DASHED' ? 'Dashed' : 'Dotted'
}));
const TEXT_SIZES = [
  { value: '0.4', label: 'Small' },
  { value: '0.6', label: 'Medium' },
  { value: '0.9', label: 'Large' }
];

const KIND_NAME: Record<Target['kind'], string> = { item: 'Item', connector: 'Connector', region: 'Region', text: 'Text' };

/**
 * The selected thing's properties. Every control speaks the same operations an agent sends over
 * MCP, so a person and an agent can never produce different kinds of diagram.
 */
export function Inspector(props: {
  model: Model;
  view: View;
  selected: Target;
  editable: boolean;
  /** Focus the first field, for something just created. */
  fresh: boolean;
  preview(operations: Operation[]): void;
  commit(operations: Operation[]): void;
  onPickIcon(): void;
  onDelete(): void;
}) {
  const { model, view, selected, preview, commit } = props;
  const title = (
    <header className="inspector-head">
      <h3>{KIND_NAME[selected.kind]}</h3>
      {props.editable && (
        <button type="button" className="btn quiet small destructive" onClick={props.onDelete} title="Delete (Del)">
          Delete
        </button>
      )}
    </header>
  );

  if (selected.kind === 'item') {
    const item = model.items.find((entry) => entry.id === selected.id);
    if (!item) return null;
    const notes = htmlToText(item.description ?? '');
    if (!props.editable) {
      return (
        <aside className="inspector" aria-label="Item">
          <h3>{item.name}</h3>
          {notes !== '' && <p className="notes">{notes}</p>}
        </aside>
      );
    }
    const icon = item.icon === undefined ? undefined : resolveIcon(model, item.icon);
    return (
      <aside className="inspector" aria-label="Item properties">
        {title}
        <Draft
          label="Name"
          value={item.name}
          autoFocus={props.fresh}
          onPreview={(name) => preview([{ op: 'update_item', item: item.id, name }])}
          onCommit={(name) => commit([{ op: 'update_item', item: item.id, name }])}
        />
        <div className="prop">
          <span className="prop-label">Icon</span>
          <button type="button" className="btn icon-choice" onClick={props.onPickIcon}>
            {icon && <img src={icon.url} alt="" />}
            {icon?.name ?? 'Choose…'}
          </button>
        </div>
        <Draft
          label="Notes"
          multiline
          value={notes}
          onPreview={(description) => preview([{ op: 'update_item', item: item.id, description }])}
          onCommit={(description) => commit([{ op: 'update_item', item: item.id, description }])}
        />
      </aside>
    );
  }

  if (!props.editable) return null;

  if (selected.kind === 'connector') {
    const connector = (view.connectors ?? []).find((entry) => entry.id === selected.id);
    if (!connector) return null;
    return (
      <aside className="inspector" aria-label="Connector properties">
        {title}
        <Draft
          label="Label"
          value={connector.description ?? ''}
          autoFocus={props.fresh}
          onPreview={(label) => preview([{ op: 'update_connector', connector: connector.id, label }])}
          onCommit={(label) => commit([{ op: 'update_connector', connector: connector.id, label }])}
        />
        <Choice
          label="Line"
          options={LINE_STYLES}
          current={connector.style ?? 'SOLID'}
          onPick={(style) => commit([{ op: 'update_connector', connector: connector.id, style }])}
        />
        <Swatches
          label="Colour"
          names={LINE_COLORS}
          current={connector.color === undefined ? 'slate' : colorName(model, connector.color)}
          onPick={(color) => commit([{ op: 'update_connector', connector: connector.id, color }])}
        />
      </aside>
    );
  }

  if (selected.kind === 'region') {
    const region = (view.rectangles ?? []).find((entry) => entry.id === selected.id);
    if (!region) return null;
    const label = (view.textBoxes ?? []).find((text) => text.id === `${region.id}-label`)?.content ?? '';
    return (
      <aside className="inspector" aria-label="Region properties">
        {title}
        <Draft
          label="Title"
          value={label}
          autoFocus={props.fresh}
          onPreview={(next) => preview([{ op: 'update_region', region: region.id, label: next }])}
          onCommit={(next) => commit([{ op: 'update_region', region: region.id, label: next.trim() }])}
        />
        <Swatches
          label="Colour"
          names={WASHES}
          current={region.color === undefined ? 'blue' : colorName(model, region.color)}
          onPick={(color) => commit([{ op: 'update_region', region: region.id, color }])}
        />
      </aside>
    );
  }

  const text = (view.textBoxes ?? []).find((entry) => entry.id === selected.id);
  if (!text) return null;
  return (
    <aside className="inspector" aria-label="Text properties">
      {title}
      <Draft
        label="Text"
        value={text.content}
        autoFocus={props.fresh}
        onPreview={(content) => preview([{ op: 'update_text', text: text.id, content }])}
        onCommit={(content) =>
          commit(content.trim() === '' ? [{ op: 'remove_text', text: text.id }] : [{ op: 'update_text', text: text.id, content: content.trim() }])
        }
      />
      <Choice
        label="Size"
        options={TEXT_SIZES}
        current={String(TEXT_SIZES.reduce((best, size) => (Math.abs(Number(size.value) - (text.fontSize ?? 0.6)) < Math.abs(Number(best.value) - (text.fontSize ?? 0.6)) ? size : best)).value)}
        onPick={(size) => commit([{ op: 'update_text', text: text.id, fontSize: Number(size) }])}
      />
      <Choice
        label="Runs"
        options={[
          { value: 'X', label: 'Up right' },
          { value: 'Y', label: 'Down right' }
        ]}
        current={text.orientation ?? 'X'}
        onPick={(orientation) => commit([{ op: 'update_text', text: text.id, orientation }])}
      />
    </aside>
  );
}
