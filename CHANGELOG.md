# Changelog

## [Unreleased]

Rich document constructs: per-cell table control, decorated text boxes,
paragraph controls, text inside shapes, and two composite elements. Pre-1.0, so
this lands in a MINOR.

### Added

- **Per-cell table control.** A `table` element resolves through a documented
  precedence chain — `cell > row > column > band (header|stripe|body) > table >
  theme > default` — and every cell now carries its own decisions:

  - **Borders**, per side, with a width in points, a colour and a
    `solid`/`dash`/`dot` style. Shorthands: a bare `{width,color}` for all four
    sides, `all`, and `outer` / `inner` which resolve by the cell's position in
    the grid. Any side can be switched off with `false`.
  - **Insets** (`style.padding`), a number for all four sides or a map naming
    the ones you want.
  - **Vertical anchor** (`style.anchor`: `top` / `middle` / `bottom`).
  - **Merging**: `colSpan` and `rowSpan` on a cell. Spans are clamped to the
    grid, and the cells a span covers are still emitted as continuations — a row
    with fewer cells than the grid declares is a corrupt file, not a narrow
    table.
  - **Column widths** (`width` on a column). Values `<= 1` are fractions of the
    table and columns without one share the remainder; any value `> 1` makes
    them all weights. Widths are accumulated and differenced so they sum to the
    table's width EXACTLY.
  - **Per-row and per-cell styling**: a row may be written as
    `{cells: {...}, fill, color, bold, align, anchor, fontSize, letterSpacing,
    caps, padding, borders, height}`, and any cell value may be an object
    carrying the same keys plus `text`.
  - **Band configuration**: `style.header` (or `false` for no header row),
    `style.body`, `style.stripe` (or `false` for no striping), `style.rowHeight`.

- **Decorated text boxes.** A `text` element's `style` takes `fill`, `border`,
  `padding`, `radius`, and `accentBar` — a coloured bar down one edge, drawn as
  a hard-stop `<a:gradFill>` so the bar and the tint are ONE shape. DrawingML
  has no per-side border on a shape, so this construct previously meant stacking
  a background rect, a thin rect and a text box in the right z-order.

- **Paragraph and run controls** on any text body: `lineHeight` (a multiple),
  `spaceBefore` / `spaceAfter` (points), `letterSpacing` (points), `caps`
  (`small` / `all`), and `bullet` — a literal character (which is all a
  check-mark list is), `none`, or `number`.

- **Text inside shapes.** A `shape` element takes `content`, `format` and
  `style`. Its text body used to be unconditionally empty.

- **Composite elements `kpiBand` and `metadataGrid`.** Authoring sugar: each
  expands into an ordinary `table` before anything is serialised, so they add no
  new OOXML and no new reader shape. A composite read back comes back as the
  table it became.

- **A reference deck fixture and its acceptance test.** A nine-slide deck built
  from the construct classes of a real paginated business document — metadata
  grid, KPI band, accent-bar callouts, tables with a highlighted total row,
  check-mark lists, a three-column comparison. It is the shared fixture for all
  three engines, compared byte-for-byte.

- **A cross-language conformance suite**, `dark-slide/table-cell-model` in
  `fancy-conformance`, pinning the resolver's decisions. Byte parity proves the
  engines agree on the inputs it runs; these rows walk the precedence chain one
  layer at a time, which byte parity on a single deck cannot.

### Changed

Six changes alter emitted bytes. Five need nothing from you; one can.

- **Table header fill and zebra derive from `theme.colors.accent`** instead of a
  hardcoded violet. `#8B5CF6` is the default accent, so a deck that sets no
  accent is unchanged. **What you must do:** nothing — unless your deck sets an
  accent and you wanted the violet, in which case set `style.header.fill`.

- **Table cells now state their borders.** Previously no line elements were
  emitted at all, which is not "no rules" — it is "unspecified", and each reader
  drew its own default table style. The default is now an explicit 0.75pt
  `#D9DEE4` grid, and "no border" is emitted as an explicit empty line rather
  than by omission. **What you must do:** nothing — unless you want no rules, in
  which case `style: {borders: false}`.

- **Cell insets and vertical anchor moved from `<a:bodyPr>` to `<a:tcPr>`**,
  which is where the schema puts them for a table cell. **What you must do:**
  nothing.

- **The table style id changed** from Medium Style 2 Accent 1 to No Style, No
  Grid. Every fill and rule is now stated per cell, so a built-in style is a
  second opinion layered on ours rather than a default to fall back on. **What
  you must do:** nothing — unless you relied on PowerPoint's own banding, which
  is now baked per cell and configurable.

- **`strokeWidth: 0` or `stroke: "none"` on a shape emits no outline.** It used
  to emit `<a:ln w="0">`, which every renderer draws as a hairline, so "no
  outline" was not sayable. **What you must do:** nothing — unless you relied on
  the hairline, in which case give `strokeWidth` a real value.

- **An object-valued table cell is now read as a cell SPEC** when it carries any
  of the spec keys (`text`, `fill`, `color`, `bold`, `italic`, `underline`,
  `align`, `anchor`, `fontSize`, `letterSpacing`, `caps`, `fontFamily`,
  `padding`, `borders`, `colSpan`, `rowSpan`). It used to be JSON-stringified
  into the cell text. **What you must do:** if you were deliberately displaying
  the JSON of an object that happens to carry one of those keys, wrap it —
  `{"text": "<the json>"}`. An object with NONE of those keys still stringifies
  exactly as before, so most callers are unaffected.

### Fixed

- **The reader dropped the first data row of a header-less table.** It assumed
  row 0 was always a header; whether it is one is declared by
  `<a:tblPr firstRow="1">`. Header-less tables only became ordinary with this
  release — every `metadataGrid` and `kpiBand` is one — so the bug is new
  surface rather than an old one, but the reader now honours the declaration.

- **Column widths declared on a column were discarded**, and every table was an
  equal split. The reader also now recovers widths as fractions.

## 0.6.2 — 2026-08-09

### Added

- **A `unicodeText` cross-engine parity fixture** — CJK, emoji, combining marks
  and accented Latin through both the markdown tokenizer and the syntax
  highlighter, diffed byte-for-byte against the PHP `dark-slide`.

  No behaviour changed. The polyglot plan listed PHP's byte indexing
  (`strlen`/`substr`) against this port's UTF-16 indexing as a live divergence;
  checked against both engines, it is not one. Both loops only compare ASCII
  markers and cut at those positions, and neither a UTF-8 continuation byte nor
  a UTF-16 surrogate can collide with ASCII.

  The fixture is here because that agreement is **incidental rather than
  designed**: a tidy to `mb_substr` or `Array.from` on either side would change
  the output, and nothing would have caught it.

## 0.6.1 — 2026-08-09

### Fixed

- **The cross-engine parity suites now actually run in CI.** They are the
  strongest guarantee this pair has — every OOXML part diffed byte-for-byte
  against the PHP `dark-slide`, plus a reader agreement check — and they had
  never executed on a runner.

  Two things combined to hide it. `describe.skipIf(!HAS_PHP)` skipped silently,
  and `ci.yml` installed Node only, so the build went green with **zero
  cross-engine coverage**. Separately, both PHP helper scripts autoloaded from a
  hard-coded `../../dark-slide/src`, which only resolves inside the `.agi`
  envelope — so even with PHP present, another layout found no classes and would
  have failed looking like a parity break.

  Now: CI installs PHP 8.4 and checks out the PHP repo; the helpers take
  `DARK_SLIDE_PHP_SRC` (falling back to the sibling path); and a missing PHP
  **throws in CI** instead of skipping.

  **What you must do:** nothing, unless you run these suites outside the
  envelope — then set `DARK_SLIDE_PHP_SRC` to the PHP package's `src`.

## 0.6.0 — 2026-08-07

### Changed

- **BREAKING — Node 18 is no longer supported.** `engines.node` moves from `>=18` to `>=22`.

  **What you must do:** on Node 22 or newer, nothing. Note npm only *warns* on an `engines` mismatch while **pnpm fails the install**, so this surfaces differently depending on your package manager. Node 18 is end-of-life and 20 is maintenance-only.

### Why

These are the kit 0.5 platform floors, applied across every package at once so a consumer never has to resolve a mix. **No API changed, nothing was removed, nothing was renamed** — only what the package requires.

## 0.5.2 — 2026-05-30

Initial Node/TypeScript port of `particle-academy/dark-slide` (PHP), at
**feature-parity with PHP 0.5.2**. Zero-dependency, isomorphic (browser + Node).
The deck schema is identical to `@particle-academy/fancy-slides`.

- Full `Agent` + `DarkSlide` surface: `validate`, `validateAndRepair`, `toBytes`,
  `write` (Node), `read`/`fromBytes`, `describe`, `jsonSchema`.
- pptx **writer** — presentation / master / 8 slide layouts / theme; text with
  inline markdown + heading scaling + bullets; image fit/crop (data-URI media);
  shapes; syntax-highlighted code; native bar/line/pie/scatter charts; real
  `<a:tbl>` tables; solid / gradient / image backgrounds; element entrance
  **animations** (`<p:timing>`: fade/fly-in/zoom/wipe, by-paragraph, click
  steps); slide transitions; whole-element hyperlinks (`<a:hlinkClick>`).
- pptx **reader** — round-trips text (markdown reconstructed), images (as
  data-URIs), shapes, tables, backgrounds (incl. gradient angle), and notes.
- Hand-rolled isomorphic ZIP (STORE write / inflate read) + tiny XML parser
  keep it dependency-free in both runtimes.
- **Verified byte-identical** to the PHP engine across markdown / shape /
  image / code / table / chart / gradient / transition / animation / hyperlink
  decks (cross-engine parity suite; `docProps/core.xml` timestamp masked).

### Notes vs PHP
- File-touching methods (`write`) are async and Node-only (browsers have no
  sync FS); everything else is sync and universal.
- Image embedding supports `data:` URIs everywhere; remote `http(s)://` / local
  file image sources cannot be fetched synchronously in the browser and fall
  back to the same `[image: …]` placeholder PHP emits when a fetch fails.
