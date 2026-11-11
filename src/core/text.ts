/**
 * Text helpers shared by the layout engine and the headless renderer. There is no font engine
 * on the server, so widths are estimates; they size boxes and reserve space, nothing more.
 */

const NARROW = " .,:;'|!ilIjtfr()[]";
const WIDE = 'mwMW@%';

/** Approximate advance width, in pixels, of sans-serif text. */
export function estimateTextWidth(text: string, fontSize: number, bold = false): number {
  let em = 0;
  for (const char of text) {
    if (NARROW.includes(char)) em += 0.32;
    else if (WIDE.includes(char)) em += 0.88;
    else if (char >= 'A' && char <= 'Z') em += 0.68;
    else if (char > '\u2e7f') em += 1;
    else em += 0.56;
  }
  return em * fontSize * (bold ? 1.06 : 1);
}

/** Greedy word wrap against the estimated width. A single over-long word keeps its own line. */
export function wrapText(text: string, maxWidth: number, fontSize: number, bold = false): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (line !== '' && estimateTextWidth(candidate, fontSize, bold) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

const TILE_PX = 100;
const TEXT_BOX_PADDING_PX = 20;

/** Tiles a text box spans along its baseline; mirrors the editor's `getTextWidth`. */
export function textBoxSpan(content: string, fontSize: number): number {
  if (content === '') return 0;
  const width = estimateTextWidth(content, fontSize * TILE_PX, true);
  return (width + TEXT_BOX_PADDING_PX * 2) / TILE_PX - 0.8;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text to the paragraph HTML the editor's rich text field stores. */
export function textToHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => `<p>${line.trim() === '' ? '<br>' : escapeHtml(line)}</p>`)
    .join('');
}

/** The editor's rich text HTML back to plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
