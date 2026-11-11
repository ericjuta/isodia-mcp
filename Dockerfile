# isodia-mcp — single-origin deployment: one process serves the web app, the REST API and MCP.
#
#   docker build -t isodia-mcp .
#   docker run -p 4400:4400 -v isodia-data:/data -e ISODIA_TOKEN=... -e ISODIA_URL=https://diagrams.example.com isodia-mcp
#
# The base must be glibc: @resvg/resvg-js ships a prebuilt native binary and does not run on musl.

FROM oven/bun:1.4-slim AS build
WORKDIR /app

# Install everything first so dependency layers survive source edits.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY web ./web
COPY src ./src
RUN bun run build

FROM oven/bun:1.4-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4400 \
    ISODIA_DB=/data/isodia.db

COPY package.json bun.lock ./
# Production dependencies only: the type checker, Vite, React and Puppeteer stay in the build
# stage. The install cache goes in the same layer, or its bytes would ship in an earlier one.
RUN bun install --frozen-lockfile --production \
 && rm -rf "${HOME}/.bun/install/cache"

# Bun runs the TypeScript sources directly, so no compile step is needed at runtime.
COPY src ./src
COPY --from=build /app/dist ./dist

# The licence and third-party notices ship with the artifact.
COPY LICENSE NOTICE.md ./

# Prove the production install can do the server's two jobs before the image exists: check a
# model (accept a good one, refuse a bad one) and draw a picture, which loads the native
# rasteriser and the bundled font. A missing runtime dependency fails the build here instead of
# shipping an image that cannot open or render a project.
RUN bun -e "const { parseModel } = await import('./src/core/schema.ts'); \
  const good = { version: '', title: 'ok', items: [], views: [{ id: 'overview', name: 'Overview', items: [], connectors: [], rectangles: [], textBoxes: [] }], icons: [], colors: [{ id: 'color1', value: '#a5b8f3' }] }; \
  if (parseModel(good).title !== 'ok') throw new Error('schema load is broken'); \
  let rejected = false; \
  try { parseModel({ version: '', title: 'x', items: [{ id: 'x', name: 'X', icon: 'nope' }], views: [], icons: [], colors: [] }); } catch { rejected = true; } \
  if (!rejected) throw new Error('schema no longer validates'); \
  const { renderViewSvg } = await import('./src/core/render.ts'); \
  const { svgToPng } = await import('./src/core/png.ts'); \
  const drawn = { ...good, items: [{ id: 'a', name: 'A', icon: 'server' }], views: [{ ...good.views[0], items: [{ id: 'a', tile: { x: 0, y: 0 } }] }] }; \
  if (svgToPng(renderViewSvg(drawn, drawn.views[0]).svg, 400).length < 1000) throw new Error('rendering is broken'); \
  console.log('schema and render check passed');"

# SQLite lives on a volume so projects survive a container replacement.
RUN mkdir -p /data && chown -R bun:bun /data
USER bun
VOLUME ["/data"]

EXPOSE 4400
# The slim image has no curl or wget, so probe with Bun's own fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "process.exit((await fetch('http://127.0.0.1:'+ (process.env.PORT ?? 4400) '/healthz')).ok ? 0 : 1)" || exit 1

CMD ["bun", "src/server/index.ts"]
