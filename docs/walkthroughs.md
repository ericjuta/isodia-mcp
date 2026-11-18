# Published walkthroughs

A walkthrough takes a reader of a technical article through an architecture one step at a time.
Each **step** is a short piece of prose, a **view** of the diagram and, optionally, one
**component** to focus on. Readers can follow the steps in order, open a step from a link in the
article, or leave the guided route to look at other published views and component notes, then
return to the step they were on. The reader is read-only: there is no editing, saving or sharing
from it.

What the article links to is a **publication**: a JSON snapshot prepared from an exported model,
reviewed by its author, and copied into a directory that the server reads. A publication is not a
live project and not a share link. The server never looks a publication up in the project
database, so editing or deleting the project changes nothing a reader sees. The publication
does not grant access to the project.

| Term | Meaning |
| --- | --- |
| component | An item in the model, such as "Payments service", with its name and notes |
| view | One diagram of the model's components; a model can have several |
| step | One stop in the walkthrough: title, prose, a view and an optional focused component |
| publication | A prepared, versioned snapshot file, named in every link to it |

## The sample

[`docs/sample/walkthrough/`](sample/walkthrough/) holds a complete, made-up example:

- [`checkout.isoflow.json`](sample/walkthrough/checkout.isoflow.json) is the source model, a
  synthetic online checkout with three views: `request-path`, `payment` and `after-the-order`.
  Import it into isodia (**Import JSON** on the project list, or the `import_project` MCP tool) to
  look at it or change it.
- [`checkout.walkthrough.json`](sample/walkthrough/checkout.walkthrough.json) is the author's
  manifest: the walkthrough's title, the article it belongs to, the views to publish and three
  steps, `request-path`, `charge-once` and `after-the-order`.

The commands below publish it as `checkout-architecture-v1`.

## 1. Draw and export the model

Draw the architecture in isodia as usual. A step shows one whole view, so give each step a view
that holds what that step talks about and little else; a view can be a second slice of the same
components (**+** beside the view tabs, or `manage_views`).

Export the project's model JSON: **Export** in the app, `export_project` over MCP, or
`GET /api/projects/<project>/export`. The export is a file you own; preparing a walkthrough never
reads the live project.

## 2. Write the manifest

```json
{
  "schemaVersion": 1,
  "title": "How checkout works",
  "articleUrl": "https://example.com/articles/checkout#architecture",
  "views": ["request-path", "payment", "after-the-order"],
  "steps": [
    {
      "id": "charge-once",
      "title": "Charge once, even when retried",
      "body": "Checkout never calls the payment provider itself. …",
      "view": "payment",
      "component": "payments"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Always `1` |
| `title` | Shown at the top of the reader |
| `articleUrl` | The article the walkthrough belongs to. The reader's return link points here, and only this URL's origin may embed the walkthrough. Must be `https://`; `http://` is accepted only for a loopback host, for local preview |
| `views` | Ids of the views to publish, in the order readers can choose them. Views not listed are left out of the publication |
| `steps[].id` | The step's name in links (`?step=charge-once`). Use lowercase words and hyphens, and never rename a published step: the article's links use it |
| `steps[].title` | A short heading for the step |
| `steps[].body` | The step's prose, as plain text |
| `steps[].view` | The id of the view the step shows; it must be one of `views` |
| `steps[].component` | Optional: the id of a component placed in that view, outlined as the step's focus |

View and component ids are the `id` fields in the exported model, under `views` and `items`:

```bash
jq -r '.views[] | "\(.id)\t\(.name)"' docs/sample/walkthrough/checkout.isoflow.json
jq -r '.items[] | "\(.id)\t\(.name)"' docs/sample/walkthrough/checkout.isoflow.json
```

## 3. Prepare the publication

```bash
bun scripts/prepare-walkthrough.ts \
  docs/sample/walkthrough/checkout.isoflow.json \
  docs/sample/walkthrough/checkout.walkthrough.json \
  /tmp/checkout-architecture-v1.json
```

The command validates the model and the manifest, keeps only the listed views and the
components, connections, regions, text, icons and colours they use, and writes a new file. It
refuses to write over a file that already exists, so an earlier version cannot be replaced by
accident. A step that names an unknown view, a view that is not published, or a component that is
not in its view is refused with the field that is wrong.

The file name, without `.json`, is the publication's name in every URL. Put a version in it
(`checkout-architecture-v1`) and use lowercase letters, digits and single hyphens.

## 4. Review the whole file

**Everything in a published view is public.** Preparation trims what the listed views do not use,
but it is not a redactor: every component name and note, connection label, region title, text box
and custom icon in those views goes into the file as it is. Read the file before publishing it,
not the diagram on screen — a note you never open in the canvas is still in the file.

```bash
out=/tmp/checkout-architecture-v1.json
jq -r '.title, .articleUrl' "$out"
jq -r '.steps[] | "\(.id): \(.title)\n  \(.body)"' "$out"
jq -r '.model.items[] | "\(.name): \(.description // "")"' "$out"
jq -r '.model.views[] | .name, (.connectors[]?.description // empty), (.textBoxes[]?.content // empty)' "$out"
jq -r '.model.icons[]?.id' "$out"   # custom icon artwork travels inside the file
```

The project's description and the views' timestamps are dropped. Nothing else is rewritten, so if
something in a published view should not be public, change the model, export it again and prepare
again.

## 5. Publish

The server reads publications from the directory named by `ISODIA_WALKTHROUGHS_DIR`. Without it,
walkthroughs are off and every walkthrough address answers `404`. The server only reads that
directory: there is no upload or write API and no listing, so a publication can be found only by
its name. Copying a file in publishes it; removing it withdraws it.

Publications are public. They do not need `ISODIA_TOKEN`, which still protects the editor, the
API and `/mcp`. Responses are sent with `Cache-Control: no-store`, so a withdrawn publication is not
served from a cache in front of the server.

### Locally

```bash
mkdir -p ~/isodia-walkthroughs
cp /tmp/checkout-architecture-v1.json ~/isodia-walkthroughs/
bun run build                                    # once; the server then serves the reader too
ISODIA_WALKTHROUGHS_DIR=~/isodia-walkthroughs bun start
```

Open http://localhost:4400/w/checkout-architecture-v1.

### In production

Keep publications in an operator-controlled directory outside both the database volume and
the web assets. Mount it read-only so the running server cannot change them:

```bash
docker run -p 4400:4400 -v isodia-data:/data \
  -v /srv/isodia/walkthroughs:/walkthroughs:ro \
  -e ISODIA_WALKTHROUGHS_DIR=/walkthroughs \
  -e ISODIA_TOKEN="$(openssl rand -hex 32)" \
  -e ISODIA_URL=https://diagrams.example.com isodia-mcp
```

Publish from the host. Stage under a temporary name, then expose the finished file with `ln`,
which refuses to replace an existing name:

```bash
(
  set -e
  dir=/srv/isodia/walkthroughs
  stage=$(mktemp "$dir/.walkthrough.XXXXXX")
  trap 'rm -f "$stage"' EXIT
  install -m 0444 /tmp/checkout-architecture-v1.json "$stage"
  ln "$stage" "$dir/checkout-architecture-v1.json"
)
```

Serve the diagrams origin over HTTPS, or an HTTPS article will refuse to load the iframe. If a
reverse proxy sets its own frame policy, make sure it preserves the app's `frame-ancestors`
policy and does not add `X-Frame-Options` or another policy that blocks the article on `/embed`.

## 6. Link and embed

With `ISODIA_URL=https://diagrams.example.com`, the publication has three addresses:

| Address | Use |
| --- | --- |
| `https://diagrams.example.com/w/checkout-architecture-v1?step=charge-once` | Full page, for links. Refuses to be framed |
| `https://diagrams.example.com/w/checkout-architecture-v1/embed?step=charge-once` | Compact reader for an iframe in the article |
| `https://diagrams.example.com/api/walkthroughs/checkout-architecture-v1` | The publication JSON |

Without `?step=` the reader opens the first step. Back and Forward move between the steps a reader
visited. A step name the publication does not have opens a notice with a way into the
walkthrough, not an empty diagram — which is what an old link gets after a step is renamed, so
don't rename them.

Embed the compact reader with a `title`, and put an ordinary link next to it. Feed readers,
e-mail digests and some privacy settings drop iframes; the link is what those readers get:

```html
<figure>
  <iframe
    src="https://diagrams.example.com/w/checkout-architecture-v1/embed?step=charge-once"
    title="Checkout architecture walkthrough, step: Charge once, even when retried"
    width="100%" height="560" loading="lazy"
    style="border: 1px solid #d8d4ca; border-radius: 8px"></iframe>
  <figcaption>
    <a href="https://diagrams.example.com/w/checkout-architecture-v1?step=charge-once">Open the
    checkout walkthrough at “Charge once, even when retried”</a> if the diagram does not load.
  </figcaption>
</figure>
```

Use the `/embed` address in iframes: the full page refuses to be framed. The embed shows a link to
open the current step full page and a link back to `articleUrl`.

### Which pages may embed it

The embed sends `Content-Security-Policy: frame-ancestors <origin>`, where the origin is the
scheme, host and port of `articleUrl`. For the sample that is `https://example.com`: any page on
`https://example.com` may frame it, and a browser refuses to show it framed anywhere else,
including `https://www.example.com`, a staging host, a syndicated copy or your own machine. Links
still work everywhere. If the article moves to another origin, publish a new version with the new
`articleUrl`.

### Previewing an embed locally

Because only the article's origin may frame the embed, an iframe on a local test page needs a
preview publication whose `articleUrl` is that local page. Plain `http://` is accepted only for a
loopback host — `localhost`, `127.0.0.1` or `[::1]` — never for a host on the network. The
browser compares origins exactly, so `http://localhost:8000` and `http://127.0.0.1:8000` are
different, and so are different ports: open the test page at exactly the origin in the manifest.

```bash
jq '.articleUrl = "http://127.0.0.1:8000/article.html#architecture"' \
  docs/sample/walkthrough/checkout.walkthrough.json > /tmp/checkout-preview.walkthrough.json
bun scripts/prepare-walkthrough.ts docs/sample/walkthrough/checkout.isoflow.json \
  /tmp/checkout-preview.walkthrough.json ~/isodia-walkthroughs/checkout-architecture-preview-1.json

mkdir -p /tmp/article && cd /tmp/article
# Write article.html with the snippet above, pointing at
# http://127.0.0.1:4400/w/checkout-architecture-preview-1/embed?step=charge-once
python3 -m http.server 8000 --bind 127.0.0.1
```

Open http://127.0.0.1:8000/article.html. The same snippet served from `http://localhost:8000`
shows a refused frame, which is the policy working. Remove the preview file when you are done; it
names a local page and is not for a real article.

## Revising and withdrawing

A published file is never edited in place. Readers, caches, archived copies and the article's
links all assume that `checkout-architecture-v1` means one thing. To revise, prepare
`checkout-architecture-v2` from the updated model and manifest, review it, publish it, and then
change the article's links. Remove `v1` when nothing should load it any more. Never reuse a
removed name for different content.

To withdraw a publication, delete its file. New loads, including iframes already in the article,
then get `404`. Withdrawal cannot recall what readers already have: tabs left open, screenshots,
saved copies, search-engine and web-archive captures, or the JSON anyone downloaded. Anything
that must stay private must never be published.

## Writing a walkthrough people can read

- **Let the article stand on its own.** The walkthrough illustrates the argument; a reader whose
  iframe did not load, or who uses a screen reader, should still follow the article.
- **One idea per step.** Three to six steps suit most articles. If a step needs a second idea, it
  is two steps.
- **Keep step prose short.** Two to four sentences, in plain text, saying what to notice and why
  it matters. Put lasting facts about a component in its notes, where readers find them in every
  view.
- **Name the focus in the prose.** The outline shows which component a step is about; the text
  should say it as well, so the step makes sense without seeing the colour.
- **Give each step a view that fits.** A view with a dozen components and one relevant
  connection makes the reader search. Make a narrower view instead.
- **Use the article's order and words.** Step titles should match the headings or sentences that
  link to them, and the components should have the names the article uses.
- **Title every iframe** with the walkthrough and the step, and keep the plain link beside it.
- **Publish something made for the public.** The sample is synthetic on purpose; draw a
  walkthrough for an article rather than publishing an internal project's views.
