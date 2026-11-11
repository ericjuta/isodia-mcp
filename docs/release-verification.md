# isodia-mcp release verification

Verified 2026-11-11 on Linux x64 with Docker 29.1.3 and Bun 1.4.4, after the design-system change
(IBM Plex, the wash palette, in-app dialogs). Re-check before relying on it.

## What was proven, and how

Everything below ran against the **Docker image** (`docker build -t isodia-mcp:final .`), not the dev
server, because the image is what ships.

- Image builds: both `bun install --frozen-lockfile` stages, the web build and the Dockerfile's schema
  check pass; 394 MB; the container runs as `bun` and reports `healthy`.
- API answers on the mapped port: `GET /api/info` → 200, `version 0.1.0`.
- MCP over HTTP in the container: `scripts/mcp-http-demo.ts` lists 15 tools and drives `create_project`,
  `build_diagram`, `render_diagram` (a real PNG) and `get_diagram`. A batch with a dangling edge comes
  back as a tool error naming the operation, and leaves the diagram as it was.
- Pictures use the bundled typeface: PNG and SVG renders of the demo project are byte-identical between
  the container and a host run of the same sources, so the image rasterises with the same font files.
- The browser smoke test (`scripts/browser-check.ts`) run against the container's own UI exits 0:
  dashboard thumbnails, editor load, history, a change made elsewhere, autosave, node drag, view
  add/duplicate/delete, share link, revoked link, connect-agent panel. The browser's only complaint
  is the deliberate 404 for the revoked link.

### Three earlier fixes still hold inside the image

1. **Revision pruning** — 130 edits on one project kept 101 revisions, not 131.
2. **Strict group schema** — `groups: [{ id, name, nodes: [...] }]` is rejected with
   `Unrecognized key: "nodes" at groups[0]` instead of silently building no region.
3. **Editor remount on view change** — the smoke test creates a text box and then adds a view: 2 views,
   the editor still rendered, zero page errors. Before the fix this scenario threw
   `Item with id ... not found` and blanked the page.

### Persistence

- Data survives **container replacement** on the same volume (`-v isodia-data:/data`): the projects, their
  revisions, views and items, a named checkpoint and a previously minted share token (still 200) were
  identical before and after the container was removed and started again.

## Editor behaviour worth knowing

- Drag works on **tiles**, not icons: the icon is `pointer-events:none` above the tile and a connector
  can swallow the press. Drag the tile just below the icon.
- The editor keeps a selection in its own state; switching to a view that lacks the selected item
  throws unless the editor remounts, which `web/src/Diagram.tsx` forces with a per-view `key`.
- Clicking near the canvas top-left hits isoflow's own controls (Main menu at ~41,85; Zoom at ~41,821).
  A MUI backdrop appearing is the Main menu or an item panel, not a defect.

## Gate commands

    bunx tsc --noEmit                                   # typecheck
    for f in scripts/*.ts; do bun build --target=bun --no-bundle "$f" >/dev/null || echo FAIL $f; done
    bun test                                            # unit and integration suites
    bun run build                                       # vite
    bun scripts/seed-demo.ts && bun scripts/browser-check.ts   # needs API :4400, Vite :4401, CHROME_PATH

`tsc` alone is not sufficient for `scripts/`: it accepts a duplicate `const` that Bun refuses to run,
so keep the `bun build --no-bundle` parse pass.
