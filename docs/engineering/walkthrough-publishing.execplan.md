# ExecPlan: publish a reviewed walkthrough snapshot

Status: implementing · Last updated: 2026-11-18 · Branch: `feat/published-walkthroughs` · [Map](walkthrough-wayfinder.md) · [Ticket #6](https://github.com/ericjuta/isodia-mcp/issues/6)

## Purpose

Make it possible to link a public article to an architecture diagram without connecting the article to its editable project. The complete public payload must be inspectable before anything is published.

## Progress

- [x] Trace model reference validation, export, server config, share API and static serving; no existing publication layer.
- [ ] Implement preparation and validation, operator configuration, and read-only HTTP routes.
- [ ] Prove projection, rejection paths, framing policy, and removal with focused tests.

## Plan of work

1. Take a Zod-validated manifest (title, article URL, ordered steps, explicit view IDs) and a separately exported Isoflow model. Project it onto the chosen views, keeping their referenced items, icons and colors only; discard project-level description and view update timestamps. Validate both the artifact and its references, including optional component focus in each step's view.
2. Add a preparation command that writes a new JSON file without overwriting an existing publication. Serve files named by simple versioned slugs from an explicitly configured directory; never query SQLite for public walkthrough data. Set no-store on publication responses. No public filesystem listing or write API.
3. For `/w/<id>/embed`, emit `Content-Security-Policy: frame-ancestors <article origin>`; deny framing on `/w/<id>`. Permit absolute HTTPS article URLs, with only HTTP loopback allowed for local preview. Test configuration off, malformed paths/artifacts, unauthenticated read and no live project exposure.

## Decisions and risks

- The trimmed artifact is a publication boundary, not a redactor. Everything within an included view, including notes, labels and custom artwork, is public; an author must review it. The filesystem operator owns immutability and must never recycle a versioned name. Withdrawal prevents new loads, not screenshots or previously downloaded copies.
- The app should not write to the publication directory. Operators mount it read-only in containers. HTTPS, TLS termination and the editor's bearer token remain deployment concerns.

## Evidence and outcomes

Pending implementation and proof. See the [reader plan](walkthrough-reader.execplan.md) for article-to-reader acceptance.
