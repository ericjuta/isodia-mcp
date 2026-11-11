/**
 * The look of everything this project draws. One warm paper, one ink, and colour reserved for
 * territory: regions take the palette, lines stay neutral unless a diagram says otherwise.
 *
 * `web/src/styles.css` repeats the paper and ink values as CSS variables; keep the two in step.
 */

export const PAPER = '#f7f5ef';
export const INK = '#1b1d22';
/** Secondary text: connector labels, captions. */
export const INK_SOFT = '#565a64';

export const FONT_FAMILY = "'IBM Plex Sans', Arial, Helvetica, sans-serif";

/**
 * The diagram palette. Tools refer to entries by name; models store the id and the value.
 *
 * The hues are washes: pale enough that a region sits behind its icons and labels instead of
 * competing with them. Slate is the exception, a mid grey meant for lines. The values are what
 * the editor paints too, so the canvas and the rendered picture agree.
 *
 * `upstream` is the open-source editor's own value for the same id, so a model made there still
 * reads back by name.
 */
export const PALETTE = [
  { name: 'blue', id: 'color1', value: '#d1d9ec', upstream: '#a5b8f3' },
  { name: 'purple', id: 'color2', value: '#dcd4ed', upstream: '#bbadfb' },
  { name: 'yellow', id: 'color3', value: '#f2e7c4', upstream: '#f4eb8e' },
  { name: 'red', id: 'color4', value: '#f1d1ca', upstream: '#f0aca9' },
  { name: 'orange', id: 'color5', value: '#f5ddc5', upstream: '#fad6ac' },
  { name: 'green', id: 'color6', value: '#d0e4ca', upstream: '#a8dc9d' },
  { name: 'teal', id: 'color7', value: '#cde5df', upstream: '#b3e5e3' },
  { name: 'slate', id: 'slate', value: '#80848c' }
] as const satisfies readonly { name: string; id: string; value: string; upstream?: string }[];

export const REGION_COLOR = 'blue';
/** Lines are neutral unless a diagram colours them, so colour keeps meaning "which zone". */
export const CONNECTOR_COLOR = 'slate';

/**
 * The order groups take colours in when a diagram does not choose. Red comes last: it reads as
 * a warning, which an arbitrary fourth group is not.
 */
export const GROUP_COLORS = ['blue', 'teal', 'purple', 'green', 'orange', 'yellow', 'red'] as const;
