# Third-party notices

`isodia-mcp` is MIT licensed (see `LICENSE`). The server, the model rules, the layout engine,
the renderer, the canvas, the web app and the icon artwork are this project's own work.

## The model format

Diagrams are stored in the model format published by the open-source
[Isoflow](https://github.com/markmanx/isoflow) editor (MIT, Copyright (c) 2023 Mark
Mankarious), so files move between isodia and other tools that read it. The original 37 icon
ids of that project's icon set are kept as names, so such files open with this project's
drawing of the same noun. No Isoflow code, component or artwork is included or bundled, and
this project is not affiliated with or endorsed by Isoflow.

## Dependencies

Fetched by `bun install`; none of this code is copied into the repository.

| Package | Used by | Licence |
| --- | --- | --- |
| `@modelcontextprotocol/sdk`, `hono`, `zod` | server | MIT |
| `pathfinding` | connector routing, on the server and in the web app | MIT |
| `chroma-js` | colour arithmetic, on the server and in the web app | BSD-3-Clause and Apache-2.0 |
| `@resvg/resvg-js` | PNG export on the server | MPL-2.0 |
| `@expo-google-fonts/ibm-plex-sans` | font files for PNG export | MIT for the package; the IBM Plex Sans font files are OFL-1.1 |
| `react`, `react-dom` | web app | MIT |
| `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` | web app fonts | OFL-1.1 |

`@resvg/resvg-js` is used unmodified as a prebuilt binary; its source is at
https://github.com/yisibl/resvg-js. IBM Plex is © IBM Corp., with Reserved Font Name "Plex".
The font files are not renamed or modified: the server loads them from the package to
rasterise PNGs, and the built web app serves the `@fontsource` copies.

## Where the notices travel

The web build minifies `react`, `react-dom`, `pathfinding` and `chroma-js` into `dist/` without
licence banners, so the notices do not travel inside a build on their own. The Dockerfile
copies `LICENSE` and `NOTICE.md` next to the app for that reason; do the same for anything
else you ship or host.
