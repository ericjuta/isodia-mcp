import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const plexDir = dirname(require.resolve('@expo-google-fonts/ibm-plex-sans/package.json'));

/** The weights the renderer emits: connector labels, item labels and text boxes. */
const FONT_FILES = [
  '500Medium/IBMPlexSans_500Medium.ttf',
  '600SemiBold/IBMPlexSans_600SemiBold.ttf',
  '700Bold/IBMPlexSans_700Bold.ttf'
].map((file) => join(plexDir, file));

/**
 * Rasterise a rendered view. IBM Plex Sans is bundled so the picture does not depend on the
 * host's fonts; system fonts stay available as fallback for scripts Plex lacks.
 */
export function svgToPng(svg: string, width: number): Uint8Array<ArrayBuffer> {
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: FONT_FILES, loadSystemFonts: true, defaultFontFamily: 'IBM Plex Sans' }
  })
    .render()
    .asPng();
  // Copied into a plain ArrayBuffer-backed array, which is what `Response` bodies accept.
  return new Uint8Array(png);
}
