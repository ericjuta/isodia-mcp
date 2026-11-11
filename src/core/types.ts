/**
 * The Isoflow diagram model, as accepted by the MIT `isoflow` editor.
 * Declared here rather than imported so the headless core does not depend on the editor's
 * bundled zod/zustand type graph. `schema.ts` validates against the editor's own schema.
 */

export interface Coords {
  x: number;
  y: number;
}

export interface Icon {
  id: string;
  name: string;
  url: string;
  collection?: string;
  isIsometric?: boolean;
}

export interface Color {
  id: string;
  value: string;
}

export interface ModelItem {
  id: string;
  name: string;
  /** HTML, as produced by the editor's rich text field. */
  description?: string;
  icon?: string;
}

export interface ViewItem {
  /** References a `ModelItem.id`. */
  id: string;
  tile: Coords;
  labelHeight?: number;
}

/** Exactly one of the three fields is set. */
export interface AnchorRef {
  item?: string;
  anchor?: string;
  tile?: Coords;
}

export interface ConnectorAnchor {
  id: string;
  ref: AnchorRef;
}

export const CONNECTOR_STYLES = ['SOLID', 'DOTTED', 'DASHED'] as const;
export type ConnectorStyle = (typeof CONNECTOR_STYLES)[number];

export interface Connector {
  id: string;
  /** Shown as the connector's label. */
  description?: string;
  color?: string;
  width?: number;
  style?: ConnectorStyle;
  anchors: ConnectorAnchor[];
}

export interface Rectangle {
  id: string;
  color?: string;
  from: Coords;
  to: Coords;
}

export type TextOrientation = 'X' | 'Y';

export interface TextBox {
  id: string;
  tile: Coords;
  content: string;
  fontSize?: number;
  orientation?: TextOrientation;
}

export interface View {
  id: string;
  name: string;
  description?: string;
  lastUpdated?: string;
  items: ViewItem[];
  rectangles?: Rectangle[];
  connectors?: Connector[];
  textBoxes?: TextBox[];
}

export interface Model {
  version?: string;
  title: string;
  description?: string;
  items: ModelItem[];
  views: View[];
  icons: Icon[];
  colors: Color[];
}
