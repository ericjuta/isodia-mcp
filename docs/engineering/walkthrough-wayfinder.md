# Wayfinder: architecture walkthroughs for technical articles

[GitHub map #5](https://github.com/ericjuta/isodia-mcp/issues/5) · Status: implementing

## Destination

A technical article can embed or link directly to a step in a read-only architecture walkthrough. Readers can follow the author's narrative, explore published views and inspect component notes without losing their place, and return to the article. Prove it on a synthetic three-step architecture, not on a private project. Land in `main`; do not deploy to an existing instance or publish an article.

## Route

| Leg | Work | Acceptance |
| --- | --- | --- |
| 1 | [#6](https://github.com/ericjuta/isodia-mcp/issues/6) · [Publishing ExecPlan](walkthrough-publishing.execplan.md) | A reviewed artifact contains the chosen views and referenced data only; no live project lookup. |
| 2 | [#7](https://github.com/ericjuta/isodia-mcp/issues/7) · [Reader ExecPlan](walkthrough-reader.execplan.md) | The same named step opens full-page and in an iframe. Readers can leave the guided view and return. |
| 3 | [#8](https://github.com/ericjuta/isodia-mcp/issues/8) · [Reader ExecPlan](walkthrough-reader.execplan.md) | Document a complete example, prove it in Chromium and land with green CI. |

## Decisions so far

- Keep the editor and interchange schema unchanged. A **component** is a shared model item, a **connection** is a view connector, a **view** is a slice of a diagram, and a **step** is an ordered narrative stop with a view and optional component focus.
- A **publication** is a versioned snapshot file. A blog is not a client of the live editor or a bearer share link. The operator reviews the whole generated artifact, publishes under a versioned name, and never modifies that file in place. Remove it to withdraw it; publish a new name to revise it.
- The source article supplies the iframe origin; full-page and iframe entry points share the same step state. Do not build a CMS, custom fields, search across diagrams, or an authoring GUI for this slice.
