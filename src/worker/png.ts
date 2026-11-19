import { initWasm, Resvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
// The same three weights as the native renderer in src/core/png.ts, inlined into the bundle:
// a Worker has no font directory to load them from at runtime.
import medium from '@expo-google-fonts/ibm-plex-sans/500Medium/IBMPlexSans_500Medium.ttf?inline';
import semibold from '@expo-google-fonts/ibm-plex-sans/600SemiBold/IBMPlexSans_600SemiBold.ttf?inline';
import bold from '@expo-google-fonts/ibm-plex-sans/700Bold/IBMPlexSans_700Bold.ttf?inline';

let ready: Promise<Uint8Array[]> | undefined;

/** Compile the renderer and decode the fonts once per isolate, on first use. */
function prepare(): Promise<Uint8Array[]> {
  ready ??= initWasm(resvgWasm).then(() =>
    [medium, semibold, bold].map((dataUrl) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (char) => char.charCodeAt(0)))
  );
  return ready;
}

/**
 * Rasterise a rendered view in the Worker with resvg compiled to WebAssembly. Only IBM Plex Sans
 * is available: there are no system fonts to fall back on, so scripts Plex lacks render as
 * missing glyphs, unlike the native renderer.
 */
export async function svgToPng(svg: string, width: number): Promise<Uint8Array<ArrayBuffer>> {
  const fontBuffers = await prepare();
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontBuffers, defaultFontFamily: 'IBM Plex Sans' }
  });
  try {
    const image = resvg.render();
    try {
      return new Uint8Array(image.asPng());
    } finally {
      image.free();
    }
  } finally {
    // WebAssembly memory is not garbage-collected; release the renderer's copy of the picture.
    resvg.free();
  }
}
