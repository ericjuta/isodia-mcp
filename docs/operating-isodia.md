# Run Isodia for other people

Use this guide if you operate the server. For a local trial, follow [Getting started](getting-started.md). For build and launch commands, use [Docker](../README.md#docker) or the [single-server build](../README.md#quick-start). To run Isodia on Cloudflare without a server, follow the [Cloudflare guide](cloudflare.md); its settings, backups and rollback differ from those below.

## Choose what you want to expose

- **Local editor:** Keep the default loopback listener. You do not need an access token if only your machine can reach the service.
- **Team editor or agent access:** Serve over HTTPS and set `ISODIA_TOKEN`. Treat the token as a shared editing credential, not a per-user account. Restrict network access if the diagrams are internal.
- **Public article:** Publish a reviewed [walkthrough snapshot](walkthroughs.md#publication-checklist). A public reader does not need the editor token. Use a separate instance if you need to keep the editor and internal data off the public host.

Do not put an unauthenticated reverse proxy in front of a tokenless instance. Binding Isodia to loopback does not make it private if a proxy forwards requests to it. Live share links and published walkthroughs remain readable without the editor token.

## Know the settings

| Setting | Purpose |
| --- | --- |
| `HOST`, `PORT` | Address and port the server listens on. The source defaults are `127.0.0.1` and `4400`. Docker listens on all interfaces inside the container. |
| `ISODIA_URL` | Base URL clients can reach, such as `https://diagrams.example.com`. It does not configure TLS or change the listening address. |
| `ISODIA_TOKEN` | Bearer token for protected project requests and remote MCP. The server refuses a non-loopback listener without it. |
| `ISODIA_DB` | SQLite database path. Defaults to `data/isodia.db` in the checkout and `/data/isodia.db` in the Docker image. |
| `ISODIA_WALKTHROUGHS_DIR` | Optional directory containing prepared public snapshots. Keep it separate from the database and web assets. |

## Before inviting anyone

- [ ] Check the URL from a device outside the server. Confirm that it uses HTTPS and that `/healthz` returns `ok`. This proves liveness, not access control.
- [ ] Open the editor in a private browser window. Confirm that it asks for the token and cannot read projects without it.
- [ ] Keep the database on persistent storage. Back it up with a SQLite-aware backup or stop the service before copying the database. Keep publication files separately. Test recovery in a separate instance.
- [ ] If you allow live shares, check one from a clean browser without the editor token. Verify that it opens only the intended project and that revocation blocks a new load.
- [ ] If you host public walkthroughs, check a direct step link and the real article iframe. Confirm that public links do not grant access to the project editor.

## Diagnose common failures

| Symptom | First check |
| --- | --- |
| The editor shows an access-token prompt or `401` | Use the token for that instance. A read-only share URL is not an editor credential. |
| A generated connection URL points to localhost | Set `ISODIA_URL` to the address remote clients can reach. Check that you also opened the editor at that address before copying a share link. |
| The editor or agent shows an empty project list | Confirm both use the same instance or the same `ISODIA_DB` if the agent runs over stdio. In Docker, check the `/data` mount. |
| The walkthrough page returns `404` | Check the publication filename, mount, read permissions, and `ISODIA_WALKTHROUGHS_DIR`. A model export is not a prepared snapshot. |
| A walkthrough link works but the iframe does not | Use the `/embed` URL. Check the article's exact origin and both sites' frame policies. See [Which pages may embed it](walkthroughs.md#which-pages-may-embed-it). |
