# Run Isodia natively on Cloudflare

This is a living ExecPlan. Update Progress, Discoveries, Decisions and evidence as work lands. [Wayfinder #13](https://github.com/ericjuta/isodia-mcp/issues/13) tracks the work.

## Outcome

An operator can run the same editor, live shares, published walkthrough reader and HTTP MCP on Cloudflare without a Linux host. The existing Bun, Docker and local stdio workflows remain supported. Repository landing does not create cloud resources, write secrets, change DNS or deploy.

## Progress

- [x] Inventory Bun-specific storage, asset serving, rasterization and filesystem publication; create map and child tickets.
- [ ] #14: Extract shared HTTP, storage, error and PNG contracts. Keep route and model semantics unchanged.
- [ ] #15: Wire one SQLite Durable Object, Worker Static Assets, deploy-time reviewed walkthrough assets and WASM rasterization.
- [ ] #16: Prove runtime parity and document deployment, migration, backups and rollback.

## Decisions

- Use one SQLite-backed Durable Object for the initial single-workspace target. Do not put a live SQLite file on ephemeral container storage or an object-store mount.
- Ship reviewed walkthrough snapshots as versioned deploy assets first. Expose them through the existing reader routes, not as raw static files. Defer R2 until publishing separately from app releases is needed.
- Keep browser assets and application routes on one origin; retain the existing token and public share/snapshot boundaries. Require the Worker token to be configured before private operations are available.
- Share model validation and rendering logic. Keep the native Bun renderer and add a Worker rasterizer with explicitly bundled fonts.

## Discoveries and risks

`bun:sqlite`, `Bun.serve`, `Bun.file`, filesystem snapshots and native resvg prevent a direct lift. HTTP MCP already uses stateless web-standard transport. Verify Durable Object transactional writes, storage limits, and 2400px PNG CPU and bundle size before calling the target ready. Local runtime proof cannot establish hosted CPU headroom. Do not assume existing Bun data can be migrated unchanged.

## Acceptance and evidence to collect

1. Existing Bun CI, editor/MCP and embed checks stay green.
2. Workers-runtime tests exercise authenticated HTTP MCP and editor save, stale-write rejection, history and shares across a storage re-open, and public share revocation. Verify missing-token behavior and that raw publication assets cannot bypass the reader boundary.
3. Serve a real versioned step link; prove allowed framing and blocked foreign origins. Verify a 2400px PNG and capture Worker bundle size and render timing. Document any hosted-only validation still outstanding.
4. Give operators explicit first-deploy and rollback instructions. A code rollback must not be described as reverting persisted data. Document backup and migration limits.

## Outcomes

Planning started. No implementation or runtime evidence yet.
