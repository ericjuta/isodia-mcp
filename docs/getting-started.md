# Start here: Isodia from a fresh checkout

Isodia is a browser editor for architecture diagrams. You can draw by hand or connect an agent through the Model Context Protocol (MCP). You do not need an agent, an account, or a hosted server to try the editor.

## 1. Run the editor

Install [Git](https://git-scm.com/install/), [Bun](https://bun.com/docs/installation), and [Node.js](https://nodejs.org/en/download) 22.12 or newer. CI uses Bun 1.4.4. The development editor runs Vite with Node.js. These examples use a shell such as Bash.

Run these commands in a terminal:

```sh
git clone https://github.com/ericjuta/isodia-mcp.git
cd isodia-mcp
bun install --frozen-lockfile
bun run dev:api
```

Leave the server running. In a second terminal in the same checkout, run:

```sh
bun run dev:web
```

Open <http://localhost:4401>. Port `4401` serves the editor and forwards `/api` and `/mcp`. Port `4400` serves the API and direct MCP connections. `dev:api` generates browser links on `4401`, unlike `bun start`, which serves a built app and the API on one port. No production build is needed for this guide.

## 2. Explore a diagram

1. Click **Import JSON** on the project list. Select [`checkout.isoflow.json`](sample/walkthrough/checkout.isoflow.json) from `docs/sample/walkthrough/`.
2. Open the imported project if the editor does not open automatically.
3. Switch between the view tabs. Click the gateway or payments service icon or label to see its name and notes in the inspector.

A **project** is the editable record. A **component** (called an *item* in JSON) is a system or service. A **view** lays out some of the project's components. The same component can appear in several views and keep the same notes.

## 3. Preview the checkout walkthrough

A **walkthrough** adds ordered steps to a diagram. Each step shows a view and can highlight a component. The sample uses an exported model and an author file called a **manifest**. This preview is separate from the project you imported.

Stop `bun run dev:api` with Ctrl+C. In that terminal, run:

```sh
preview=$(mktemp -d)
bun scripts/prepare-walkthrough.ts \
  docs/sample/walkthrough/checkout.isoflow.json \
  docs/sample/walkthrough/checkout.walkthrough.json \
  "$preview/checkout-architecture-v1.json"
ISODIA_WALKTHROUGHS_DIR="$preview" bun run dev:api
```

Keep `bun run dev:web` running. Open [the payment step](http://localhost:4401/w/checkout-architecture-v1?step=charge-once). Check that the payment step opens directly. Click another component or switch views to explore, then choose **Return to step**. This preview checks the reader, not iframe permissions. Use the [publishing guide](walkthroughs.md) to test an embed through the server that supplies the frame policy.

## First-run checklist

- [ ] The project list opens at `http://localhost:4401`. If it does not, check that both terminals are still running.
- [ ] The imported checkout project shows multiple views. Clicking a component shows its notes.
- [ ] The walkthrough link opens the payment step directly. **Return to step** restores the step after you explore.

You do not need to complete the walkthrough preview to draw your own diagram. Follow the [editor guide](using-isodia.md#draw-your-first-flow) to start with a blank project.

## What to do next

| Goal | Where to start |
| --- | --- |
| Let an agent draw or edit | [Connect an agent and draw a first diagram](../README.md#connect-an-agent). The editor's **Agent** panel provides connection settings. |
| Let someone follow the current project | [Check and send a live share](using-isodia.md#check-a-live-share-before-sending-it). Anyone with the link can read the shared project, and later edits appear there. |
| Link to or embed a diagram in an article | [Publish a walkthrough](walkthroughs.md). It uses a reviewed snapshot, not the live project. Everything in that snapshot is public. Only the article's origin can frame the embed. |
| Run Isodia on a server | [Operator checklist](operating-isodia.md). Do not expose the editor or MCP without authentication. |
| Change the code | Read [DESIGN.md](../DESIGN.md) before changing the editor. Start in [`src/core`](../src/core) for the model and renderer, [`src/server`](../src/server) for storage and HTTP/MCP, or [`web/src`](../web/src) for the browser UI. See the [CI workflow](../.github/workflows/ci.yml) for the checks. |

## Use different local ports

If either default port is in use, stop the Isodia dev processes you started. Run these commands in separate terminals from the checkout:

```sh
# Terminal 1: API
PORT=4510 ISODIA_WEB_PORT=4511 bun run dev:api
```

```sh
# Terminal 2: editor
PORT=4510 ISODIA_WEB_PORT=4511 bun run dev:web
```

Open <http://localhost:4511>. Replace `4401` with `4511` in the walkthrough preview link. Keep the same port settings when you restart to preview a walkthrough. Connect HTTP MCP at <http://localhost:4510/mcp>. For stdio, set `ISODIA_URL` to `http://localhost:4511` in the client configuration. Leave `ISODIA_URL` unset in the dev API terminal unless you want to override the generated browser links.

## If something does not open

- **The project list cannot load:** Check the `dev:api` terminal for its listening address. Use the same `PORT` for `dev:web` so the editor reaches that API.
- **The walkthrough is not found:** Check that you restarted `dev:api` with `ISODIA_WALKTHROUGHS_DIR` set and that the output file is named `checkout-architecture-v1.json`.
- **You want to stop the local demo:** Press Ctrl+C in both terminals. The imported project stays in `data/isodia.db` by default. The temporary snapshot is separate from that database.
