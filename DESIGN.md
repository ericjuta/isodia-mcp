# Design

How isodia looks, and why. This file covers two surfaces that must agree: the web app
around the editor, and the pictures the renderer exports.

The values below are copied from `src/core/theme.ts` (what the renderer draws with) and
`web/src/styles.css` (the app's CSS variables). If this file and the code disagree, the code
is what users see and this file is the bug: fix it in the same commit.

## Position

**The diagram is the only colourful thing on screen.** Everything else is paper, ink and
hairlines. A diagram tool whose chrome competes with the diagram has its priorities backwards.

Three consequences follow, and most rules below are one of them restated:

1. **Colour is information, never decoration.** In a diagram it means "which zone". In the app
   it means "an agent did this", "you are here" or "this failed".
2. **The exported picture is the product.** It will be pasted into a README and shown at half
   size next to body text. It is designed for that, not for the editor's zoom level.
3. **Quiet beats clever.** No gradients, no glass, no drop shadows on resting surfaces, no
   illustration, no animation that is not reporting state.

## Things we do not do

- **No dark theme.** The washes are tuned against one paper, and exported pictures land on
  light pages. A second theme doubles the palette work to serve the surface that matters less.
- **No second accent.** If two things need highlighting, one of them does not.
- **No coloured lines by default.** A line that is coloured for no reason teaches the reader
  that line colour means nothing.
- **No icons in the chrome.** Words for actions (`History`, `Share`, `Export`, `Agent`). The
  only glyphs are `+`, `⋯` and `×`, and each has an accessible name.
- **No native `prompt`, `confirm` or `alert`.** Use `askText` and `askConfirm` from
  `web/src/ui.tsx`.
- **No bare element selectors in CSS.** The embedded editor shares the document; a `button {}`
  rule restyles its toolbar. Every rule is class-scoped (`.btn`, `.field`, `.tab`).
- **No theming of a picture after the fact.** The renderer draws what the model stores. It
  does not recolour old diagrams to match a new palette.

## Tokens

### Ground and ink

| Token | Value | Use | Contrast on paper |
| --- | --- | --- | --- |
| `--paper` / `PAPER` | `#f7f5ef` | Page, canvas, picture background | n/a |
| `--surface` | `#fdfcf9` | Bars and side panels | n/a |
| `--raised` | `#ffffff` | Controls, cards, menus, dialogs, picture labels | n/a |
| `--ink` / `INK` | `#1b1d22` | Text, primary button, item labels | 15.5 |
| `--ink-2` / `INK_SOFT` | `#565a64` | Secondary text, connector labels | 6.3 |
| `--ink-3` | `#6b6e76` | Metadata that can be missed | 4.7 |
| `--line` | `#e4e0d5` | Hairline between surfaces | 1.2 |
| `--line-strong` | `#cfcabc` | Control and menu borders | 1.5 |
| `--wash` | ink at 6% | Hover, segmented track, neutral badge | n/a |

Paper is warm on purpose. Pure white makes the washes look grey and the vendor icons look
pasted on; a slightly yellow ground makes both sit in the page.

There is one ink. Do not introduce a "brand dark", a blue-black or a second grey ramp.

### Signal colours (app only)

| Token | Value | Meaning | Contrast on paper |
| --- | --- | --- | --- |
| `--accent` | `#d9480f` | Agent activity, current position, keyboard focus, the mark | 3.9 |
| `--accent-ink` | `#b03a0c` | Accent as small text, only on `--accent-soft` | 5.1 on soft |
| `--accent-soft` | `#fbe8dc` | Ground for an accent badge or a notice | n/a |
| `--ok` | `#2f7a4d` | Saved | 4.8 |
| `--warn` | `#9a6400` | Unsaved, saving | 4.6 |
| `--danger` | `#b3261e` | Failed save, destructive confirm | 6.0 |

The accent is a burnt orange because nothing in the diagram palette is: every wash is pale,
so a saturated warm colour can only be chrome. It is spent on exactly four things: the top
face of the mark, the underline of the active view tab, the focus ring, and anything an agent
did (the `mcp` badge in history, the Agent dot, the live dot on a share page). A new use has
to displace one of those.

Status colours appear only as a 7 px dot beside a word, or as the text of an error, never
without the word. The single filled use is the confirm button of a destructive dialog.

### Diagram palette

Stored in every model as `colors`. Tools refer to entries by name.

| Name | Id | Wash | As a line (L* 40) | As a title (L* 27) |
| --- | --- | --- | --- | --- |
| blue | `color1` | `#d1d9ec` | `#475f86` | `#264165` |
| purple | `color2` | `#dcd4ed` | `#64568a` | `#443869` |
| yellow | `color3` | `#f2e7c4` | `#6a5f0b` | `#494000` |
| red | `color4` | `#f1d1ca` | `#8a4e42` | `#672f25` |
| orange | `color5` | `#f5ddc5` | `#7e5623` | `#5b3803` |
| green | `color6` | `#d0e4ca` | `#3b6934` | `#1b4916` |
| teal | `color7` | `#cde5df` | `#2f685d` | `#09483e` |
| slate | `slate` | `#80848c` | `#555f71` | not used |

- **Washes are territory.** Lightness 86 to 92: a region sits behind its icons and labels. Ink
  on any wash is at least 11.8:1.
- **Slate is for lines.** It is the default connector colour and the only entry that is not a
  wash. Do not fill a region with it.
- **Ink is derived, not chosen.** `inked()` in `src/core/render.ts` keeps a colour's hue and
  forces its lightness, so every line lands near 5.9:1 on paper and every title above 7:1 on
  its own wash. Adding a palette colour needs no matching "dark" value.
- **Groups take colours in a fixed order** when a diagram does not choose: blue, teal, purple,
  green, orange, yellow, red. Red is last because it reads as a warning, and an arbitrary
  seventh group is not one.
- **Palette entries are the final values.** The editor paints them as stored, so the canvas
  and the export agree. Do not tint again in the renderer.

Colours travel with the model. A project made before a palette change, or in the open-source
editor, keeps the colours it was drawn with; the `upstream` field in `PALETTE` keeps those
older values readable by name. Changing `PALETTE` affects new and rebuilt diagrams only.

### Type

IBM Plex Sans for words. IBM Plex Mono for anything literally typed or counted: revision
numbers, share links, configuration, the wordmark. If you would not paste it into a terminal
or read it as a number, it is not mono.

| Where | Size / weight |
| --- | --- |
| App body | 14 / 400, line height 1.45 |
| Controls, tabs, hints | 13 / 500 (controls), 13 / 400 (hints) |
| Metadata, mono | 12 |
| Panel section heads, badges | 11 / 500 mono, uppercase heads tracked 0.06em |
| Dialog title, panel title | 15 / 600, 14 / 600 |
| Page headings | 22 / 600 (dashboard), 18 / 600 (empty states) |
| Picture: item name | 22 / 600, wraps at 290 px |
| Picture: connector label | 19 / 500, wraps at 210 px |
| Picture: region title | 60 / 700 on the tile plane |

Three weights in the app (400, 500, 600) and three in pictures (500, 600, 700). No italics,
no light weights, no letter-spacing except the two cases above.

The app loads Latin woff2 files from `@fontsource`. PNG export bundles the TTFs from
`@expo-google-fonts/ibm-plex-sans`, so a picture rendered in a container is byte-identical to
one rendered on a laptop. System fonts remain as fallback for scripts Plex lacks.

### Shape, space, depth

| Thing | Value |
| --- | --- |
| Control radius | 6 px |
| Menu and segmented radius | 8 px |
| Card and dialog radius | 10 px |
| Control height | 30 px (26 small, 34 in dialogs) |
| Top bar / panel head | 48 px / 44 px |
| Side panel width | 372 px |
| Dashboard measure | 1120 px, cards at least 300 px, 16 px gap |
| Panel padding and gap | 16 px / 12 px |

Surfaces are separated by a 1 px hairline. Exactly two things cast a shadow, because exactly
two things float above the page: menus and dialogs (`--lift`). The editor's own floating
controls are given the same border and lift so they belong to the same family.

### Motion

Motion reports state and does nothing else. A dot pulses while saving (1 s) and on a live
share page (2.4 s). Card borders ease over 120 ms. `prefers-reduced-motion` stops the pulses.
No entrance animations, no page transitions.

## The app

- **One bar.** Brand, project name, view tabs, panel switch, save state. Nothing wraps; tabs
  scroll.
- **Buttons.** `.btn` is a white control with a border. `.primary` is solid ink and there is
  at most one per surface. `.quiet` has no border until hovered and is the default inside
  bars and lists. `.danger` exists only as the confirm button of a destructive dialog.
- **Panels** (`History`, `Share`, `Export`, `Agent`) open one at a time beside the canvas and
  never over it. The diagram stays visible while you act on it.
- **Destructive actions** always ask, in a dialog that names the thing and says what goes
  with it. Reversible ones say how to undo.
- **Secondary actions appear on hover** (card delete, snippet copy), and are always visible on
  touch devices and when focused.
- **Empty states** carry the mark, one sentence and one way forward.
- **Save state is always on screen** as a dot and words: `Saved · r12`, `Unsaved changes`,
  `Saving…`, `Not saved`.

### Words

- Sentence case everywhere. No title case, no exclamation marks, no "please", no "successfully".
- Buttons are verbs that name their object when it is not obvious: `Delete project`, `Add
  view`, `Restore`. Never `OK` or `Yes`.
- A confirmation states the consequence, not the question twice: "Its history and share links
  go with it. This cannot be undone."
- Say what happened in the product's terms: "revision", "view", "share link", "agent".
  Not "version", "tab", "URL", "AI".
- Times are relative for a week, then a date; the exact time is on hover.

## The picture

The renderer follows the editor for geometry (same projection, same matrices, same draw order)
and departs from it for finish. The editor is a working surface seen zoomed in. The export is
read small.

- **Background** is paper, with 40 px of margin. Pass `background: null` for transparent.
- **Regions** are a wash with a 2.5 px edge in a slightly deeper version of the same colour
  and 22 px corners.
- **Region titles** are the wash's own hue at L* 27, with a halo in the wash colour 26% of the
  type size wide. A line passing behind a title breaks around the word.
- **Lines** are 10 px, inked to L* 40, over a paper casing 1.6 times as wide. Where two lines
  cross, the casing makes one visibly pass over the other.
- **Arrowheads** take the line's ink and a 4 px paper edge.
- **Item labels** are white boxes with a hairline, 8 px corners, ink text. They are the
  strongest text in the picture because they name the things.
- **Connector labels** are white pills in soft ink. The pill shape is the distinction: a
  rounded rectangle is a thing, a pill is something that travels.
- **Label placement** is on the route, on a free tile with the most clearance from every item,
  nearest the middle. Two labels never share a tile.

Default export width is 1400 px; the worked examples use 1600. Natural canvases run from
about 2,300 to 3,600 px wide, so a 22 px label lands between 10 and 15 px in a 1600 px file.
That is the budget. Judge every picture at the size a reader will meet it, not at full size.

## Drawing a diagram

These apply to people and to agents calling `build_diagram`.

- **A region is a boundary that exists.** A network, a trust zone, a deploy unit, a phase.
  Not "misc" and not "things I had left over".
- **Colour regions by kind, consistently across views.** If the hub is blue in one view it is
  blue in all of them. Use red only for what is untrusted or dangerous.
- **Leave lines slate.** Colour a line only to make a claim about that one path, such as the
  route that bypasses a check, and expect to explain it in the caption.
- **Line style is grammar.** Solid: a call on the main path. Dashed: asynchronous or
  scheduled. Dotted: not a request at all, such as a result returning, a retry loop, or a
  document that describes something.
- **Label lines with what crosses them**, in two or three words: `session cookie`,
  `ES256, 5 min`, `claims rows`. Not `calls`, not `uses`. An unlabelled line is fine when the
  endpoints make it obvious.
- **Name items as the reader would say them aloud.** Put the route, table or file in the
  description.
- **Fifteen items is a full view.** Past that the canvas grows beyond what a 1600 px export
  can carry and labels drop under 10 px. Make a second view; items are shared across views
  for exactly this reason.
- **One question per view.** "Where does it run", "what happens to a message", "who holds the
  credentials". A view that answers two answers neither.
- **Render it and look.** `render_diagram` returns a real image. Check for lines across
  titles and labels under icons before calling it done.

## Debts

Known, not fixed. Listed so nobody rediscovers them or mistakes them for intent.

- **Control borders are 1.5:1.** Controls are identified by their white fill on paper and
  their label, not the border. Accepted for buttons; weakest on empty text fields.
- **The editor's tool highlight is MUI blue.** `isoflow@1.1.1` builds its own theme and
  exposes no hook. So are in-editor label sizes and the 60 px region titles. Fixing these
  means forking the editor.
- **The `server` and `router` icons carry stray specks** to the right of the artwork. They
  are in the upstream SVGs and show in the editor and in exports alike.
- **Lines still cross region titles.** The halo keeps the title legible; the real fix is
  routing in `src/core/layout.ts`.
- **A connector pill can slide partly under a neighbouring icon** when items sit three tiles
  apart. It is a spacing question, not a type one.
- **Text width is estimated**, about 5 to 10% wide for Plex. Boxes are slightly generous and
  never clip. Measuring with the real font would tighten them.
- **Paper and ink are written twice**, in `theme.ts` and `styles.css`, and kept in step by
  hand.

## Changing the design

1. Change the token in `src/core/theme.ts` or `web/src/styles.css` (both, for paper and ink).
2. Update this file in the same commit. A look change that leaves `DESIGN.md` untouched is
   not finished.
3. Run `bunx tsc --noEmit`, `bun test` and `bun run build`.
4. Render the worked example and look at the PNGs at 1600 px, then at half that.
5. Run `scripts/browser-check.ts` against a production build. It finds controls by selector
   (`.seg button`, `[title="Add a view"]`, `[aria-label="View actions"]`), so chrome changes
   may need it updated.
6. A font or dependency change alters the lockfile: rebuild the image and compare a PNG from
   the container with a host render of the same project, byte for byte.
7. Pictures already committed to other repositories do not regenerate themselves.

Before adding anything, ask which of the three statements under [Position](#position) it
serves. If the answer is "it looks nicer", it does not go in.

## Decisions

| Date | Decision | Why |
| --- | --- | --- |
| 2026-11-11 | One light theme on warm paper | Exports land on light pages; washes are tuned to one ground |
| 2026-11-11 | Palette changed from saturated fills to washes | Regions were competing with the icons standing in them |
| 2026-11-11 | Connectors default to slate | Line colour had been inherited from regions and meant nothing |
| 2026-11-11 | Lines and titles inked by lightness, not by a second palette | One rule covers every colour, including ones a diagram adds |
| 2026-11-11 | Slate set to `#80848c` | The editor saturates connector colours; a bluer grey turned visibly blue |
| 2026-11-11 | Roboto replaced by IBM Plex, bundled for PNG export | One typeface in app and picture; renders identical on any host |
| 2026-11-11 | Picture labels raised to 22 and 19 px | Editor-sized labels were unreadable at half scale |
| 2026-11-11 | Native prompts replaced by in-app dialogs | Browser dialogs cannot mask a token, name a consequence or match the page |
| 2026-11-11 | `--ink-3` darkened to `#6b6e76`; `--accent-ink` added for badge text | Both carried 11 to 12 px text below 4.5:1 (3.1 and 3.6). "Safe to miss" still has to be readable |
| 2026-11-11 | History panel says "revision" | It was the only place that said "version" |
| 2026-11-11 | Named isodia (repository `isodia-mcp`); wordmark, MCP server name and `ISODIA_*` settings follow | The old name borrowed two other projects' names. A product gets one name of its own, used everywhere, with no aliases for the old one |
