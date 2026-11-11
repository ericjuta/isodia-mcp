# isodia-mcp — single-origin deployment: one process serves the web app, the REST API and MCP.
#
#   docker build -t isodia-mcp .
#   docker run -p 4400:4400 -v isodia-data:/data -e ISODIA_URL=https://diagrams.example.com isodia-mcp
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
# The editor bundle and the icon catalog are each several megabytes by design.
RUN bun run build

FROM oven/bun:1.4-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4400 \
    ISODIA_DB=/data/isodia.db

COPY package.json bun.lock ./
# Production dependencies only: the type checker, Vite and Puppeteer stay in the build stage.
#
# `isoflow` is a runtime dependency for its zod model schema, and it declares the React editor's
# whole UI tree (MUI, emotion, Quill, gsap…) as its own dependencies. The server only loads
# dist/standaloneExports.js, which is a self-contained bundle with no external requires, so that
# tree is dead weight. It is removed in this same layer as the install: deleting it afterwards
# would leave the bytes in an earlier layer and ship them anyway. The install cache is dropped for
# the same reason — it is not needed once the dependencies are on disk.
RUN bun install --frozen-lockfile --production \
 && rm -rf node_modules/@mui node_modules/@emotion node_modules/react-quill node_modules/gsap \
           node_modules/paper node_modules/dom-to-image node_modules/mui-color-input \
           node_modules/react-router-dom node_modules/file-saver node_modules/recharts \
 && rm -rf "${HOME}/.bun/install/cache"

# Bun runs the TypeScript sources directly, so no compile step is needed at runtime.
COPY src ./src
COPY --from=build /app/dist ./dist

# Attribution ships with the artifact: the image bundles Isoflow (MIT) and vendor icon artwork.
COPY LICENSE NOTICE.md ./

# Prove the trimmed tree still validates: it must parse a good model and reject a bad one. If a
# future `isoflow` release starts requiring any removed package, the build fails here instead of
# shipping an image that cannot open a project. This sits after COPY src so it re-runs only when
# the sources change, not on every dependency change.
RUN bun -e "const { parseModel } = await import('./src/core/schema.ts'); \
  const good = { version: '', title: 'ok', items: [], views: [{ id: 'overview', name: 'Overview', items: [], connectors: [], rectangles: [], textBoxes: [] }], icons: [], colors: [{ id: 'color1', value: '#a5b8f3' }] }; \
  if (parseModel(good).title !== 'ok') throw new Error('schema load is broken'); \
  let rejected = false; \
  try { parseModel({ version: '', title: 'x', items: [{ id: 'x', name: 'X', icon: 'nope' }], views: [], icons: [], colors: [] }); } catch { rejected = true; } \
  if (!rejected) throw new Error('schema no longer validates'); \
  console.log('schema check passed');"

# SQLite lives on a volume so projects survive a container replacement.
RUN mkdir -p /data && chown -R bun:bun /data
USER bun
VOLUME ["/data"]

EXPOSE 4400
# The slim image has no curl or wget, so probe with Bun's own fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "process.exit((await fetch('http://127.0.0.1:'+ (process.env.PORT ?? 4400) +'/api/info')).ok ? 0 : 1)" || exit 1

CMD ["bun", "src/server/index.ts"]
