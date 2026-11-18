# ExecPlan: read and embed a guided walkthrough

Status: verified · Last updated: 2026-11-18 · Branch: `feat/published-walkthroughs` · [PR #9](https://github.com/ericjuta/isodia-mcp/pull/9) · [Map](walkthrough-wayfinder.md) · [Ticket #7](https://github.com/ericjuta/isodia-mcp/issues/7) · [Ticket #8](https://github.com/ericjuta/isodia-mcp/issues/8)

## Purpose

Let readers follow the argument in an article and inspect the infrastructure without editing it. A writer can link to an exact step, and a reader can navigate with browser history or return to the article.

## Progress

- [x] Trace the read-only canvas, item selection and inspector; share page currently has no step or history URL.
- [x] Implement the reader, compact iframe, focus, accessible component controls and article backlink.
- [x] Supply the three-step sample and run focused and built-app browser verification. Landing status is tracked by PR #9.

## Plan of work

1. Add `/w/<publication>?step=<step>` and `/w/<publication>/embed?step=<step>`. Step links have real hrefs. Back and Forward work on the full page; inside an iframe, the active step replaces its URL so the article keeps its own history. An unknown step gives a clear fallback rather than a blank diagram.
2. Use the existing canvas for pan, zoom, and component clicks. Draw the guided focus with the accent outline. Show step prose separately from component notes. Let visitors choose other published views and components, including via a keyboard-operable component picker; keep the current step and make returning explicit.
3. Keep iframe chrome compact. Show an open-full-page link for the current step and a return-to-article link. Use the same responsive layout and verify a narrow viewport. Document design and terminology in `DESIGN.md`.
4. Provide a synthetic architecture and three real steps plus copyable iframe/link instructions. Browser proof must cover direct links, history, clicking canvas and keyboard controls, switching views and returning, iframe actually running from the permitted origin, blocked other origin, and no editing controls.

## Decisions and risks

- A step is narrative, not an additional editable diagram object. Free exploration is local to the reader, rather than rewriting the article's stable deep link. Prefer a quiet reader rail to a second editor toolbar.
- In a narrow embed, controls and prose scroll with the page; leave enough canvas space to pan and zoom. Use plain text for authored narrative and notes.

## Evidence and outcomes

- A scratch Vite/Chromium check passed direct navigation, rendered-item click and notes, Return to step focus, Back/Forward, keyboard pick, and a 345 px viewport without horizontal overflow.
- [GitHub CI](https://github.com/ericjuta/isodia-mcp/actions/runs/44404041090) ran the full suite and build, then `scripts/walkthrough-browser-check.ts` on the real checkout sample with three loopback origins. It proved the reader and deep links, target and focus restoration, separate article history, short-iframe zoom stability, allowed framing, and refused framing from a different origin. It did not publish an instance or an article.
- Independent review of the initial implementation found no correctness or security blockers. The reader now keeps zoom when notes change in short embeds, focuses the step heading on navigation or return, and leaves the article's Back history alone. Browser checks cover those decisions. The public route validates each file read; if traffic warrants caching later, preserve the file-withdrawal behavior.
