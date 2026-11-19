/** Reviewed publications bundled by the root vite.config.ts: validated JSON text by id. */
declare module 'virtual:isodia/walkthroughs' {
  const publications: Readonly<Record<string, string>>;
  export default publications;
}

/** The Cloudflare Vite plugin imports `.wasm` files as compiled modules. */
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}

/** Vite inlines a `?inline` import as a base64 data URL. */
declare module '*?inline' {
  const dataUrl: string;
  export default dataUrl;
}
