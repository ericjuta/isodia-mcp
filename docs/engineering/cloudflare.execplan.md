# Run Isodia natively on Cloudflare

This is a living ExecPlan. Update Progress, Discoveries, Decisions and evidence as work lands. [Wayfinder #13](https://github.com/ericjuta/isodia-mcp/issues/13) tracks the work.

## Outcome

An operator can run the same editor, live shares, published walkthrough reader and HTTP MCP on Cloudflare without a Linux host. The existing Bun, Docker and local stdio workflows remain supported. Repository landing does not create cloud resources, write secrets, change DNS or deploy.

## Progress

- [x] Inventory Bun-specific storage, asset serving, rasterization and filesystem publication; create map and child tickets.
- [x] #14: Extract shared HTTP, storage, error and PNG contracts. Keep route and model semantics unchanged.
  - `Store` takes a synchronous `SqlDatabase` (`src/server/sql.ts`); `openSqlite` (`src/server/sqlite.ts`) keeps the Bun pragmas and `BEGIN IMMEDIATE`. Share tokens come from Web Crypto and revocation uses `DELETE … RETURNING` instead of Bun's change count.
  - `createApp` receives `rasterize`, optional `stdio` and an optional `WalkthroughReader`; it no longer reads files or uses `Buffer`, `node:crypto` or `import.meta.dir`. Disk reads and static serving moved to `src/server/disk.ts`. The bearer comparison is a portable constant-time loop.
  - `requireToken` closes private APIs and MCP with 503 while no token is set; `/healthz`, `/api/shared/*` and published walkthroughs stay public. `StorageLimitError` maps to 413.
  - Evidence (2026-11-19): focused Bun tests for store, API, MCP, walkthroughs and render passed (38 tests); `scripts/onboarding-browser-check.ts` passed in Chromium. The local embed check could not run against the stale `dist/` from 2026-11-11 (no reader page in that build); CI builds `dist/` first.
- [x] #15: Wire one SQLite Durable Object, Worker Static Assets, deploy-time reviewed walkthrough assets and WASM rasterization.
  - `cloudflare.config.ts` declares the `isodia` Worker (`src/worker/index.ts`), the `ASSETS` binding, the `ISODIA_TOKEN` secret, one SQLite `Workspace` Durable Object export, SPA asset handling with `runWorkerFirst` for `/api/*`, `/mcp`, `/w/*` and `/healthz`, and `previewUrls: false`. The root `vite.config.ts` ships `dist/` as assets through `@cloudflare/vite-plugin`; `web/vite.config.ts` still owns the web build and Bun development.
  - `Workspace` runs `createApp` over `durableObjectSql` (`storage.sql.exec` and `transactionSync`) with `requireToken: true`; links use the request origin. The Worker answers `/w/*` and `/api/walkthroughs/*` itself and forwards everything else to `getByName('workspace')`.
  - Publications in `ISODIA_WALKTHROUGHS_DIR` are validated by `readWalkthroughFile` (the Bun reader's rules) when the Worker is built and bundled as `virtual:isodia/walkthroughs`; an invalid file fails the build. They are not static assets.
  - `src/worker/png.ts` uses `@resvg/resvg-wasm` with IBM Plex Sans 500/600/700 inlined. There is no system-font fallback.
  - `src/worker/tsconfig.json` type-checks the Worker and every shared module it imports against generated Workers runtime types, so Bun or Node APIs in shared code fail `bun run typecheck`.
  - Evidence (2026-11-19, local workerd via the dev server, `bun scripts/worker-runtime-check.ts`): token guard 401; MCP create, build and an 800px PNG; a 2400px PNG export (111 263 bytes, 637 ms wall time); editor save, stale-write 409 and checkpoint; a 9 MiB custom icon refused with 413 and rolled back; public share; project deletion cascades to history and share links; reader routes with `frame-ancestors`; no raw publication path; project, checkpoint and share survive a Worker restart; revocation; and 503 on private routes without `ISODIA_TOKEN`. `tsc -p src/worker/tsconfig.json` passed. CI run [44502160342](https://github.com/ericjuta/isodia-mcp/actions/runs/44502160342) at `9658542` passed the built-Worker run in workerd, including the Chromium embed with a blocked second origin; `cf deploy --dry-run --prebuilt` reported 4414 KiB, 1612 KiB compressed, and `cf workers check` 1 650 253 compressed bytes and 37.7 ms active local startup.
- [x] #16: Prove runtime parity and document deployment, migration, backups and rollback.
  - `scripts/worker-runtime-check.ts` now also proves that an 800px Worker PNG is byte-identical to the native Bun renderer's for the same model (Latin text, including `É`).
  - `docs/cloudflare.md` covers what runs where, differences from Bun, plan choice, local `cf dev`, first deploy with `--secrets-file`, later deploys, token rotation, custom domains, untested Access bypass paths, publishing and withdrawal, data limits, backups, a Bun-to-Worker copy loop, code-only rollback with `cf workers deployments create`, the irreversible class or Worker deletion, logs and open hosted checks. README, `operating-isodia.md`, `walkthroughs.md`, `release-verification.md` and DESIGN.md link to it or record the font difference.
  - Evidence (2026-11-19): the documented `cf dev` started the Worker; the documented copy loop moved two projects from a scratch Bun server to the local Worker, and the copied project kept its item; the dev-server runtime check passed with the PNG parity assertion.

## Decisions

- Use one SQLite-backed Durable Object for the initial single-workspace target. Do not put a live SQLite file on ephemeral container storage or an object-store mount.
- Ship reviewed walkthrough snapshots as versioned deploy assets first. Expose them through the existing reader routes, not as raw static files. Defer R2 until publishing separately from app releases is needed.
- Keep browser assets and application routes on one origin; retain the existing token and public share/snapshot boundaries. Require the Worker token to be configured before private operations are available.
- Share model validation and rendering logic. Keep the native Bun renderer and add a Worker rasterizer with explicitly bundled fonts.
- Answer `/w/*` and `/api/walkthroughs/*` in the Worker, outside the workspace object, so public readers never queue behind editors. Everything else in `runWorkerFirst` goes to the object.
- Build editor and share links from the request origin on the Worker instead of an `ISODIA_URL` variable: `workers.dev` and a custom domain both produce correct links without configuration.
- Turn off version preview URLs: every version shares the one workspace object.
- Keep `web/vite.config.ts` for the web build and Bun development; the root `vite.config.ts` only adds the Cloudflare plugin and serves `dist/` as assets. A Worker build requires `dist/` first.
- Type-check the Worker project (`src/worker/tsconfig.json`) in `bun run typecheck` against `cf workers types` output so shared modules stay free of Bun and Node APIs.

## Discoveries and risks

`bun:sqlite`, `Bun.serve`, `Bun.file`, filesystem snapshots and native resvg prevent a direct lift. HTTP MCP already uses stateless web-standard transport. Verify Durable Object transactional writes, storage limits, and 2400px PNG CPU and bundle size before calling the target ready. Local runtime proof cannot establish hosted CPU headroom. Do not assume existing Bun data can be migrated unchanged.

- Durable Object SQLite enforces the store's `ON DELETE CASCADE`: a project recreated under a deleted project's id starts with one revision, and the deleted project's share link returns 404.
- Durable Object SQLite caps a string or row at 8 MB. Bun has no such cap, so a model with large custom icons saves on Bun and returns 413 on the Worker. `transactionSync` rolled the refused write back.
- The MCP SDK constructs an Ajv validator, but uses it only for elicitation, which Isodia does not request; the Worker ran every MCP tool used in the check without code generation from strings.
- `cf` 1.0.0-rc.1 depends on `@cloudflare/config` rc.1 while `@cloudflare/vite-plugin` 2.0.0-rc.2 uses rc.2; both pinned exactly. Vite warns that the root config imports extensionless TypeScript modules (through `src/server/disk.ts`), which a future native config loader will not support. It is a warning only.
- The Workers Free plan limits a request to 10 ms of CPU; a local 2400px export takes about 0.6 s of wall time, so the guide recommends Workers Paid. Hosted CPU is unmeasured.
- Cloudflare keeps 30 days of point-in-time recovery for SQLite Durable Objects, but Isodia does not call the API, so the guide documents JSON export as the only operator backup.
- Cloudflare blocks a rollback to a version older than a secret change unless the deployment bypasses that check.

## Acceptance and evidence to collect

1. Existing Bun CI, editor/MCP and embed checks stay green.
2. Workers-runtime tests exercise authenticated HTTP MCP and editor save, stale-write rejection, history and shares across a storage re-open, and public share revocation. Verify missing-token behavior and that raw publication assets cannot bypass the reader boundary.
3. Serve a real versioned step link; prove allowed framing and blocked foreign origins. Verify a 2400px PNG and capture Worker bundle size and render timing. Document any hosted-only validation still outstanding.
4. Give operators explicit first-deploy and rollback instructions. A code rollback must not be described as reverting persisted data. Document backup and migration limits.

## Outcomes

2026-11-19: #14, #15 and #16 implemented on `feat/cloudflare-workers` (draft PR #17). The Bun server, Docker image and stdio MCP still use the same store and app through `openSqlite`, `src/server/disk.ts` and the native rasteriser. The Worker passed the runtime check in local workerd and in CI against the built Worker, and its Build Output validated with `cf deploy --dry-run`. Nothing was deployed: no Cloudflare resource, secret, route or DNS record exists. Still open and hosted-only: a real deploy, hosted CPU for a 2400px export, cold start, a custom domain and Cloudflare Access.
