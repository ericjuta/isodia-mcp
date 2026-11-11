# Third-party notices

`isodia-mcp` is MIT licensed (see `LICENSE`). It depends on, and in the browser bundles,
the following third-party work.

## Isoflow

- `isoflow@1.1.1` — MIT. Copyright (c) 2023 Mark Mankarious.
  https://github.com/markmanx/isoflow
  Required notice for the upstream work this project builds on:

      MIT License

      Copyright (c) 2023 Mark Mankarious

      Permission is hereby granted, free of charge, to any person obtaining a copy
      of this software and associated documentation files (the "Software"), to deal
      in the Software without restriction, including without limitation the rights
      to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
      copies of the Software, and to permit persons to whom the Software is
      furnished to do so, subject to the following conditions:

      The above copyright notice and this permission notice shall be included in all
      copies or substantial portions of the Software.

      THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
      IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
      FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
      AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
      LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
      OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
      SOFTWARE.

  The editor component, its isometric renderer and its interaction model come from this
  package. This project supplies its own server, model tooling, MCP surface and web shell,
  and does not ship or include Isoflow Pro.

## Isoflow icon packs

- `@isoflow/isopacks@0.0.10` — declared licence `Varies`; the package states that each
  collection carries its own terms and that consumers must read them.
  https://github.com/markmanx/isopacks

  Collections used here:

  | Collection | Artwork source | Terms |
  | --- | --- | --- |
  | `isoflow` | Isoflow.io | MIT, Copyright (c) 2023 Mark Mankarious |
  | `aws` | Amazon Web Services architecture icons | AWS icon terms of use |
  | `azure` | Microsoft Azure architecture icons | Microsoft icon terms |
  | `gcp` | Google Cloud architecture icons | Google Cloud icon terms |
  | `kubernetes` | Kubernetes community icon set | Community project terms |

  The vendor collections are trademarked architecture artwork. Using them in diagrams is
  intended by their publishers, but the trademark and icon terms stay with the vendors:
  redistribution, alteration of the artwork, or use implying endorsement is not granted here.
  If you ship this project publicly, confirm the current terms for the collections you enable.

## Direct dependencies

| Package | Licence |
| --- | --- |
| `@modelcontextprotocol/sdk`, `hono`, `zod`, `pathfinding`, `react`, `react-dom` | MIT |
| `chroma-js` | BSD-3-Clause and Apache-2.0 |
| `@resvg/resvg-js` | MPL-2.0 |
| `@expo-google-fonts/ibm-plex-sans` | MIT for the package; the IBM Plex Sans font files are OFL-1.1 |
| `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` | OFL-1.1 |

`@resvg/resvg-js` is used unmodified as a prebuilt binary; its source is at
https://github.com/yisibl/resvg-js. IBM Plex is © IBM Corp., with Reserved Font Name "Plex".
The font files are not renamed or modified: the server loads them from the package to rasterise
PNGs, and the built web app serves the `@fontsource` copies.

## Libraries inside the Isoflow editor bundle

The published `isoflow` package is one prebuilt bundle (`dist/index.js`) that inlines its own
dependencies; only `react` and `react-dom` stay external. Building the web app copies that
bundle into `dist/`, so a built image or a hosted instance redistributes these libraries as
well. The table lists what `isoflow` declares, with the licence each package states; the GSAP
and Quill versions are the ones in the banners upstream kept
(`node_modules/isoflow/dist/index.js.LICENSE.txt`).

| Library | Licence |
| --- | --- |
| GSAP 3.11.4 | GreenSock "Standard 'no charge'" licence, https://gsap.com/standard-license. **Not open source**: it grants use, keeps all rights with its owner and prohibits some uses. Copyright 2008-2022, GreenSock |
| Quill 1.3.7, through `react-quill` | BSD-3-Clause. Copyright (c) 2014, Jason Chen; Copyright (c) 2013, salesforce.com |
| `chroma-js` | BSD-3-Clause and Apache-2.0 |
| `@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled`, `mui-color-input`, `react-quill`, `react-hook-form`, `react-router-dom`, `zustand`, `immer`, `paper`, `pathfinding`, `zod`, `uuid`, `file-saver`, `dom-to-image`, `auto-bind` | MIT |

## Where the notices travel

None of this code is copied into the repository: `bun install` fetches it into `node_modules`,
each package with its own licence file. The web build minifies it into `dist/` without licence
banners, so the notices do not travel inside a build on their own. The Dockerfile copies
`LICENSE` and `NOTICE.md` next to the app for that reason; do the same for anything else you
ship or host.
