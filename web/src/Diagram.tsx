import { Isoflow, type IsoflowProps } from 'isoflow';
import { useCallback, useMemo } from 'react';
import { PAPER } from '../../src/core/theme';
import type { Model } from '../../src/core/types';
import { hydrate, strip } from './catalog';

/** What the editor should display. A new object reloads the editor, so replace it deliberately. */
export interface Shown {
  /** Stored form: custom icons only. */
  model: Model;
  view: string;
  /** Zoom and pan to fit the view; false keeps the user's current viewport. */
  fit: boolean;
}

// Stable references: the editor re-runs its setup when these props change identity.
const EDITOR_MENU: NonNullable<IsoflowProps['mainMenuOptions']> = ['ACTION.OPEN', 'EXPORT.JSON', 'EXPORT.PNG'];
const NO_MENU: NonNullable<IsoflowProps['mainMenuOptions']> = [];
const RENDERER: NonNullable<IsoflowProps['renderer']> = { backgroundColor: PAPER };

interface Props {
  shown: Shown;
  editable: boolean;
  /** Receives the stored form of the model after every change, including the initial load. */
  onChange?: (model: Model) => void;
}

/**
 * The open-source Isoflow editor, fed stored models. It lives in its own chunk together with
 * the icon catalog, which is why pages import it lazily.
 */
export default function Diagram({ shown, editable, onChange }: Props) {
  const initialData = useMemo(
    () => ({ ...hydrate(shown.model), view: shown.view, fitToView: shown.fit }),
    [shown]
  );
  const onModelUpdated = useCallback((model: Model) => onChange?.(strip(model)), [onChange]);

  return (
    // Keyed by view: the editor keeps a selection in its own state, and swapping in a view that
    // lacks the selected item throws "Item with id ... not found" and leaves the page blank.
    // Remounting gives each view a clean editor.
    <Isoflow
      key={`${shown.view}:${shown.model.views.length}`}
      initialData={initialData}
      editorMode={editable ? 'EDITABLE' : 'EXPLORABLE_READONLY'}
      mainMenuOptions={editable ? EDITOR_MENU : NO_MENU}
      renderer={RENDERER}
      onModelUpdated={onModelUpdated}
    />
  );
}
