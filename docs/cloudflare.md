# Run Isodia on Cloudflare

Isodia can run as one Cloudflare Worker instead of a Bun server or a Docker container. You do not need a host or a disk. The editor, live shares, published walkthroughs and HTTP MCP behave as they do on Bun, with the differences listed below.

`cloudflare.config.ts` describes the Worker. Use the [`cf` CLI](https://developers.cloudflare.com/cf/) for every Cloudflare command. Nothing in this repository deploys by itself: a deploy, a custom domain and a secret are your decisions.

## What runs where

| Part | On Cloudflare |
| --- | --- |
| Web app | Static assets from `dist/`, built by `bun run build`. |
| API, editor saves, live shares, HTTP MCP | One SQLite-backed Durable Object, `Workspace`, named `workspace`. It runs the same app and store as the Bun server. |
| Published walkthroughs | Reviewed files from `ISODIA_WALKTHROUGHS_DIR`, checked and bundled into the Worker when it is built. The Worker answers `/w/*` itself. |
| PNG export | resvg compiled to WebAssembly, with IBM Plex Sans bundled. |

## Differences from the Bun server

- **No stdio MCP.** Agents connect over HTTP to `/mcp`. The Agent panel shows only the HTTP configuration.
- **Closed until configured.** Until `ISODIA_TOKEN` is set, the editor, API and MCP answer `503`. `/healthz`, live shares and published walkthroughs stay public.
- **Links follow the request.** Editor and share links use the address the request arrived on, such as the `workers.dev` address or a custom domain. There is no `ISODIA_URL`.
- **No fallback fonts in pictures.** IBM Plex Sans covers Latin scripts. Text in a script Plex lacks, such as Chinese or Arabic, renders as missing glyphs. On Bun, system fonts fill the gap. For Latin text, a Worker PNG is byte-identical to a Bun PNG.
- **One row is at most 8 MB.** Each save stores the whole model in one row. A model larger than that, usually because of large custom icons, is refused with `413` and nothing changes.
- **Publishing needs a deploy.** Adding, changing or withdrawing a walkthrough means building and deploying the Worker again.
- **One workspace object.** Every editor and agent request goes to the same Durable Object. This keeps saves in strict order. Published walkthroughs do not wait on it.
- **No version preview URLs.** All Worker versions share the one workspace, so an untested version must not reach it. `previewUrls` is off.

## Before you start

- A Cloudflare account. Use the Workers Paid plan. The Free plan limits a Worker request to 10 ms of CPU time, and a PNG export needs far more: a 2400 px export took about 0.6 s of wall time in local tests.
- [Bun](https://bun.com/docs/installation) 1.4.4 and [Node.js](https://nodejs.org/en/download) 22.18 or newer. `cf` and Vite run on Node.js.
- For a deploy, sign in with `npx cf auth login`, or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Try it on your machine

```bash
bun install --frozen-lockfile
bun run build                                   # writes dist/, the Worker's assets
printf 'ISODIA_TOKEN=%s\n' "$(openssl rand -hex 32)" > .dev.vars
npx cf dev
```

Open the address `cf dev` prints and enter the token from `.dev.vars`. `.dev.vars` is ignored by Git and is never deployed. Local projects are kept in `.cloudflare/state`. Set `ISODIA_CLOUDFLARE_STATE` to keep them somewhere else.

To preview walkthroughs, set `ISODIA_WALKTHROUGHS_DIR` to a directory of prepared files before `npx cf dev`.

To check the Worker in the Workers runtime without signing in, run:

```bash
bun scripts/worker-runtime-check.ts
```

It starts the Worker on scratch storage and checks the token guard, MCP, PNG export, saves and conflicts, history, shares, deletion, restarts and the reader routes. CI also builds the Worker and repeats the check against the build output. It then validates the build with `cf deploy --dry-run`, which needs no credentials and uploads nothing.

## Deploy for the first time

1. Build the web app:

   ```bash
   bun run build
   ```

2. Create a secrets file outside the repository, for example `~/isodia-secrets.json`. Keep it private:

   ```json
   { "ISODIA_TOKEN": "<output of openssl rand -hex 32>" }
   ```

3. Deploy. Set `ISODIA_WALKTHROUGHS_DIR` only if you publish walkthroughs:

   ```bash
   ISODIA_WALKTHROUGHS_DIR=/path/to/reviewed-walkthroughs \
     npx cf deploy --secrets-file ~/isodia-secrets.json
   ```

   The build log lists every walkthrough it publishes. A file that fails validation stops the build.

4. Check the result:

   - [ ] `https://isodia.<your-subdomain>.workers.dev/healthz` returns `ok`.
   - [ ] In a private browser window, the editor asks for the token and shows no projects without it.
   - [ ] A walkthrough step link opens, if you published one. Check the article iframe as described in the [publication checklist](walkthroughs.md#publication-checklist).
   - [ ] An MCP client reaches `https://isodia.<your-subdomain>.workers.dev/mcp` with the header `Authorization: Bearer <token>`.

## Deploy again

```bash
bun run build
ISODIA_WALKTHROUGHS_DIR=/path/to/reviewed-walkthroughs npx cf deploy
```

A deploy without `--secrets-file` keeps the secrets of the previous version. To change the token, deploy with a secrets file that holds the new token. Every browser and agent then needs the new token.

## Use your own domain

Add the hostname to `worker` in `cloudflare.config.ts`, for example `domains: ['diagrams.example.com']`. The zone must be in the same Cloudflare account. The deploy creates the DNS record. Links follow the new hostname without other changes. To stop serving on `workers.dev`, also set `workersDev: false`.

Cloudflare Access can add single sign-on in front of the editor. This setup is not tested. If you add it, leave these paths open, or shares, walkthroughs and agents stop working: `/s/*`, `/w/*`, `/api/shared/*`, `/api/walkthroughs/*`, `/assets/*` and `/mcp`.

## Publish and withdraw walkthroughs

Prepare and review each file as described in [Published walkthroughs](walkthroughs.md). Keep the reviewed files in a directory outside the repository. Then deploy with `ISODIA_WALKTHROUGHS_DIR` set to it.

To withdraw a walkthrough, remove its file and deploy again. A rollback to an older version publishes again whatever that version bundled, including walkthroughs you withdrew later.

## Your data

All projects, revisions and share links are in the SQLite database of the `workspace` Durable Object. The limit is 10 GB on Workers Paid and 1 GB on Free.

- **Backups.** Isodia has no backup or restore command on Cloudflare. Cloudflare keeps 30 days of point-in-time recovery for SQLite-backed Durable Objects, but Isodia has no code that uses it, so a restore needs a code change and a deploy. To keep your own copy, export each project's JSON (see below). An export holds the current model only, not its history or share links.
- **Moving from Bun.** Nothing moves automatically. This copies the current model of every project from a Bun server to the Worker. History, checkpoints and share links do not move. Create share links again after the move.

  ```bash
  OLD=https://diagrams.example.com OLD_TOKEN=... NEW=https://isodia.<your-subdomain>.workers.dev NEW_TOKEN=...
  curl -fsS -H "authorization: Bearer $OLD_TOKEN" "$OLD/api/projects" | jq -r '.[] | [.id, .name] | @tsv' |
  while IFS=$'\t' read -r id name; do
    curl -fsS -H "authorization: Bearer $OLD_TOKEN" "$OLD/api/projects/$id/export" |
      jq --arg name "$name" '{name: $name, model: .}' |
      curl -fsS -H "authorization: Bearer $NEW_TOKEN" -H 'content-type: application/json' --data-binary @- "$NEW/api/projects" |
      jq -r --arg old "$id" '"\($old) -> \(.id)"'
  done
  ```

  Each line shows the old and new project id. They differ only when a project with that name already exists on the Worker. To back up the Worker, run the same loop with the Worker as `OLD` and save each export to a file instead.

## Roll back

A rollback changes code, not data. Projects saved after the version you return to stay as they are, and walkthroughs return to what that version bundled.

```bash
npx cf workers versions list --worker isodia
npx cf workers deployments create --worker isodia --strategy percentage \
  --versions '[{"version_id":"<VERSION_ID>","percentage":100}]'
```

Cloudflare refuses a rollback to a version older than a secret change. The Workers dashboard offers the same rollback under **Deployments**.

Do not remove or rename the `Workspace` export in `cloudflare.config.ts` or `src/worker/index.ts`. A Durable Object class marked deleted takes every project with it. Deleting the Worker deletes the workspace too. Neither can be undone.

## Logs

Workers Logs are on (`observability` in `cloudflare.config.ts`). Read them in the Workers dashboard or with `npx cf o11y`.

## Not proven yet

The local and CI checks run the Worker in workerd, the Workers runtime, but not on Cloudflare. These are still open:

- A real deploy, including the Durable Object and the secret.
- CPU time of a 2400 px PNG export on Cloudflare. CI measures about 0.6 s of wall time locally.
- Cold start on Cloudflare. CI reports the bundle at 4.4 MiB, 1.6 MiB compressed, with about 40 ms of local startup.
- A custom domain and Cloudflare Access.
