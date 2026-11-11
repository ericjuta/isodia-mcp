# isodia-mcp release verification

Verified 2026-11-11 on Linux x64 with Docker 29.1.3 and Bun 1.4.4, after isodia became its own
software: its own model schema, icon set and canvas, and no Isoflow, MUI, Quill or GSAP code in
the dependency tree. Re-check before relying on it.

## What was proven, and how

- **Dependencies.** `isoflow` and `@isoflow/isopacks` are gone from `package.json` and `bun.lock`;
  nothing under `src/`, `web/`, `scripts/`, `test/` or `examples/` imports them.
- **Gates on the host.** Typecheck, the `scripts/` parse pass, the unit and integration suites and
  the web build all pass.
- **Single-origin production build.** `scripts/browser-check.ts` against `bun run build` served
  by the API alone passes every step: dashboard thumbnails; the canvas draws every item of an
  agent-built project with its icon and opening it writes no revision; history; a change made
  elsewhere appears without a spurious save; on a scratch project, the empty state's first item,
  icon search by a product name (`postgres` → `database`), naming in the inspector, a second item,
  Connect with a label, dragging an item, refusing a drop on a taken tile, drawing and titling a
  region, undo and redo, the Text tool and the Delete key, each checked against what the server
  stored; a stale revision poll answered after a save is not taken for a change made elsewhere;
  views added, duplicated and deleted; a share page that is live and read-only, draws every
  icon, shows an item's card on click, and cannot change the project; a revoked link; the
  connect-agent panel. The check fails on any page error other than the 404 it causes.
- **MCP.** Over stdio, 15 tools register and `scripts/mcp-demo.ts` drives them all. Over HTTP,
  `scripts/mcp-http-demo.ts` builds, renders a real PNG and reads back a diagram, and a batch with
  a dangling edge comes back as a tool error naming the operation, with the diagram unchanged.
- **Docker image.** `docker build -t isodia-mcp:final .` passes both frozen installs, the web
  build and the build-time check (accept a good model, refuse a bad one, render a PNG with the
  bundled font). The image is 332 MB, runs as `bun` and reports `healthy`; `/api/info` answers.
  Inside the container: the HTTP MCP demo and the browser check pass, and a PNG of the seeded
  demo project is byte-identical to a host render of the same project.

## The canvas, worth knowing

- Presses resolve to a tile first, then to what stands there (item, text, connector, smallest
  region). Dragging works from anywhere on an item's tile.
- Every canvas edit is one of the MCP operations, applied in the browser and saved as a model.
  A refused edit (a taken tile) shows the same message an agent would get.
- A change arriving from elsewhere replaces what the canvas holds and clears its undo history.

## Gate commands

    bunx tsc --noEmit                                   # typecheck
    for f in scripts/*.ts; do bun build --target=bun --no-bundle "$f" >/dev/null || echo FAIL $f; done
    bun test                                            # unit and integration suites
    bun run build                                       # vite
    bun scripts/seed-demo.ts && bun scripts/browser-check.ts   # needs a running server and CHROME_PATH
    bun scripts/icon-sheet.ts --out sheet.png           # look at it after any icon change

`tsc` alone is not sufficient for `scripts/`: it accepts a duplicate `const` that Bun refuses to run,
so keep the `bun build --no-bundle` parse pass.
