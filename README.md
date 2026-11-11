# isodia-mcp

Isoflow-compatible isometric architecture diagrams with an MCP server, revision history and
share links. Built on the MIT-licensed [Isoflow](https://github.com/markmanx/isoflow) editor and
its icon packs, whose vendor collections keep their own terms (see [Licence](#licence)).

This is an independent project. It is not affiliated with or endorsed by Isoflow, and it contains
no Isoflow Pro code.

The editor is one surface; the product is the **model, the history and the agent interface**.
Agents can create, lay out, edit and render diagrams through MCP, and humans get the same
diagrams in a browser with autosave, revision history and read-only share links.

## Quick start

```bash
bun install
bun start          # API + MCP over HTTP on :4400
bun run dev:web    # web app on :4401, proxying /api and /mcp to :4400
```

Open http://localhost:4401. Create a project, or let an agent do it (below).

For a single-origin deployment, build the web app once and let the API serve it:

```bash
bun run build      # writes dist/
bun start          # serves the app and the API together
```

The build is a normal deploy step, so run it in CI or at release time.

### Docker

```bash
docker build -t isodia-mcp .
docker run -p 4400:4400 -v isodia-data:/data \
  -e ISODIA_URL=https://diagrams.example.com isodia-mcp
```

`ISODIA_URL` is the address clients reach, and it is what the Connect-agent panel and share
links print — set it to the public URL, not localhost. Projects live in `/data/isodia.db`, so
mount a volume or they are lost with the container; the image runs as the unprivileged `bun` user
and the volume is created with the right ownership. Set `ISODIA_TOKEN` to require a bearer
token on the API and the HTTP MCP endpoint.

The base image must be glibc, because `@resvg/resvg-js` ships a prebuilt native binary and does
not run on musl; the provided image is Debian-based. Images are ~390 MB, mostly the Bun base. The
build prunes the React editor's dependency tree from the runtime stage — the server only needs
`isoflow`'s standalone model schema — and the Dockerfile asserts that the schema still loads and
still rejects invalid models, so a future `isoflow` release cannot silently break validation.

## Connect an agent

The built-in panel (**Agent** in the editor) prints both configurations.

**stdio**, on the same machine — nothing to host:

```json
{
  "mcpServers": {
    "isodia": {
      "command": "bun",
      "args": ["/absolute/path/to/isodia-mcp/src/server/mcp-stdio.ts"]
    }
  }
}
```

**HTTP**, when the server is reachable over the network:

```json
{ "mcpServers": { "isodia": { "type": "http", "url": "http://localhost:4400/mcp" } } }
```

Both processes share one SQLite file (`ISODIA_DB`), so an agent over stdio and the web app
see the same projects. The default path is resolved from the repository, not the working
directory, so both find the same file however they are started.

Some MCP clients start stdio servers with a filtered environment. If you change
`ISODIA_DB`, set it explicitly in the server's `env` block as well, or the server falls back
to the default and appears empty.

### Tools

| Tool | Purpose |
| --- | --- |
| `list_projects`, `create_project`, `delete_project` | Project lifecycle |
| `get_diagram` | Read a view: items with tiles, connectors, regions, text |
| `build_diagram` | Replace a view with nodes/edges/groups, laid out automatically |
| `edit_diagram` | Atomic batch of edits: add, place, update, move, remove, connect, regions, text, `auto_layout` |
| `manage_views` | Create, rename, copy or delete views |
| `search_icons` | Find icon ids across the bundled collections |
| `render_diagram` | PNG image or SVG source of a view |
| `list_revisions`, `restore_revision`, `save_checkpoint` | History |
| `share_project` | Create, list and revoke read-only share links |
| `export_project`, `import_project` | Isoflow model JSON in and out |

`render_diagram` returning a real image is what lets an agent check its own layout instead of
guessing.

Revision history keeps the newest 100 revisions, the original import and any revision named with
`save_checkpoint`; older unnamed autosaves are pruned so storage stays bounded. Each revision is a
full model snapshot, so name the ones worth keeping.

```bash
bun scripts/mcp-demo.ts                    # every tool over stdio, with a real MCP client
bun scripts/mcp-http-demo.ts               # the same over the HTTP endpoint
bun scripts/registration-check.ts          # handshake against the stdio entry point
```

`examples/busy.ts` is a worked example against a real repository: it builds five views
(deployment, message path, durable work, trust boundaries, repository map) through the MCP
server, saves a checkpoint and writes an SVG and a 1600 px PNG per view plus the Isoflow model.
`--png-only` skips the SVGs, which embed the icon artwork and are large. It runs against a live
server and recreates its own project each time:

```bash
PORT=4410 ISODIA_DB=/tmp/busy-docs.db bun src/server/index.ts &
bun examples/busy.ts --url http://127.0.0.1:4410 --out /tmp/busy-diagrams
```

## Model and layout

A project is one Isoflow model: a shared list of **items** (name, icon, description) plus one or
more **views** that place those items on a tile grid. So "the same systems, for a different
audience" is a second view, not a second diagram.

`build_diagram` lays out a graph: edges flow from the upper left toward the lower right, each
group becomes a titled coloured region sized to hold its title, and regions never overlap. A
region's title sits on its own row inside its upper edge, so it never collides with the icon
artwork or labels of the items below. `edit_diagram` changes the layout surgically and leaves
everything else where it is.

Connector labels are placed on the route, not on the nearest tile: the renderer picks a free
tile with the most clearance from every item, closest to the middle of the route. A label on an
item's tile would vanish behind the icon, because items paint last, and two labels on one tile
would hide each other.

Every operation is checked against the editor's own zod schema before it is stored, so a model
that cannot be opened in the editor cannot enter the database.

## Design

One look runs through the app and the pictures it renders: warm paper, one ink, pale washes
for regions, neutral lines, IBM Plex, and a single orange accent kept for what an agent did
and where you are. [`DESIGN.md`](DESIGN.md) has the tokens, the rules for drawing a diagram,
the reasons, and the known debts. The values live in `src/core/theme.ts` and
`web/src/styles.css`.

Colours are stored in each model, so a project made before a palette change, or in the
open-source editor, keeps the colours it was drawn with.

## Storage

One SQLite file (WAL, so several processes can share it):

- `projects` — the current model and a revision counter
- `revisions` — every saved state, with what made it (`editor`, `mcp`, `api`, `import`, `restore`)
- `share_links` — tokens granting read access to one project

Editor autosaves collapse into one revision per two-minute burst, so a burst of keystrokes does
not bury the history. Agent edits and checkpoints always stand alone.

Optimistic concurrency: the editor saves against the revision it loaded. If an agent changed the
project meanwhile, the save is refused (`409`) and the browser shows the newer revision.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4400` | HTTP port |
| `ISODIA_DB` | `data/isodia.db` | SQLite file shared by all processes |
| `ISODIA_URL` | `http://localhost:$PORT` | Public base URL used in links and MCP output |
| `ISODIA_TOKEN` | unset | When set, the API, `/mcp` and the app require `Authorization: Bearer <token>` |

Share links are always public: the token is the credential. That is what makes a shared diagram
openable by a client without an account.

## Security

- **No authentication by default.** With `ISODIA_TOKEN` unset, anyone who can reach the port
  can read, change and delete every project through the API and `/mcp`. Set the token before the
  server is reachable by anyone but you.
- **The server listens on all interfaces** (`0.0.0.0`), not only localhost. On a shared network,
  set the token or put a firewall or reverse proxy in front.
- **A share link is a credential.** Anyone holding it can read that project until you revoke it.
- **Diagram text is user content.** The bundled Isoflow editor renders rich text through Quill;
  its handling of hostile HTML has not been audited here, so do not open projects or share links
  from people you do not trust.
- The stdio MCP server has the same access as the user who starts it; it does not check the token.

Report vulnerabilities privately through the repository's security advisories, not public issues.

## HTTP API

`GET/POST /api/projects`, `GET/DELETE /api/projects/:id`, `PUT /api/projects/:id/model`,
`POST /api/projects/:id/build`, `POST /api/projects/:id/operations`,
`GET /api/projects/:id/render`, `GET /api/projects/:id/export`,
`GET /api/projects/:id/revisions`, `POST /api/projects/:id/revisions/:n/restore`,
`POST /api/projects/:id/checkpoints`, `GET/POST /api/projects/:id/shares`,
`DELETE /api/shares/:token`, `GET /api/icons`, `POST /mcp`,
and the public `GET /api/shared/:token`.

## Tests

```bash
bun test                                      # unit and integration suites
bun scripts/seed-demo.ts                       # rebuild the two demo projects the browser check drives
export CHROME_PATH=/usr/bin/chromium           # any Chrome or Chromium binary
bun scripts/browser-check.ts                  # browser smoke test; needs both dev servers
bun scripts/mcp-demo.ts                       # MCP over stdio, end to end
bun scripts/mcp-http-demo.ts                  # MCP over HTTP, end to end
```

`browser-check.ts` expects the `payments-platform` and `acme-retail-platform` demo projects, so run
`seed-demo.ts` first on a fresh database. Both scripts read `API_URL`/`WEB_URL` and default to the
dev ports; the browser check also needs `CHROME_PATH`. It exits non-zero when a step fails, leaves
one revoked share link behind, and prints what the browser complained about under `page errors`.
Two entries belong there: the deliberate 404 for the revoked link, once as a response and once as
a console message. Against the dev servers React adds warnings from inside the bundled Isoflow
editor, about list keys and `findDOMNode`; a production build has none.

Both serving modes are covered. Point both variables at a single-origin server to check the
production path, where no proxy sits in front of `/api` or `/mcp`:

```bash
bun run build
PORT=4500 ISODIA_URL=http://127.0.0.1:4500 bun src/server/index.ts &
API_URL=http://127.0.0.1:4500 bun scripts/seed-demo.ts
WEB_URL=http://127.0.0.1:4500 API_URL=http://127.0.0.1:4500 bun scripts/browser-check.ts
```

CI owns the full build and test gates; `bun run build` is a deploy step, not part of a code
change.

## Notes on the editor

- `isoflow@1.1.1` externalises only `react`/`react-dom` and bundles its own MUI, Quill and zod.
  It calls `ReactDOM.findDOMNode`, so **React 18 is required** — React 19 removed it.
- Stored models keep only custom icons. The bundled catalog is several megabytes of inlined SVG,
  so it is added in the browser (and on demand for standalone exports) rather than stored per
  project.
- The editor's "Open" and "Export JSON" menu items are hidden; import and export run through the
  server so history and validation always apply.
- The editor's canvas takes the paper colour and typeface, and its floating controls take the
  app's borders. Its tool highlight stays MUI blue: the editor builds its own theme and exposes
  no hook for it.
- The `server` and `router` icons carry a few stray pixels to the right of the artwork. They
  are in the upstream SVGs, so they show in the editor and in rendered pictures alike.

## Licence

MIT — see [`LICENSE`](LICENSE). The Isoflow editor and the `isoflow` icon collection are MIT
licensed (Copyright (c) 2023 Mark Mankarious). The AWS, Azure, GCP and Kubernetes icon
collections are vendor artwork under the vendors' own terms, not MIT. The editor's published
bundle also inlines third-party libraries, among them GSAP, which is free to use but not open
source. This repository contains neither the artwork nor those libraries (they are installed
from npm), but a built image or hosted instance redistributes both, so read
[`NOTICE.md`](NOTICE.md) before publishing either.
