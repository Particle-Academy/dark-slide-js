# AGENTS.md — dark-slide (Node / TypeScript)

This file describes **this repository's code**: its API, its invariants, and the
traps in it. Process rules — release lifecycle, publishing, version policy,
backports — live in the envelope's `AGENTS.md` and must never be copied here; a
copy on a maintenance branch would freeze a rule that has since changed, with
nothing to flag it.

## What this is

A zero-dependency, isomorphic `.pptx` writer + reader — its own zip and inflate
implementations live in `src/zip/`, deliberately, so the package runs in a
browser and adds no supply chain. It is one of three engines that must produce
the same document from the same deck:

| | |
|---|---|
| PHP | `particle-academy/dark-slide` — **the reference** |
| Node | this repo |
| Python | `fancy-dark-slide` |

## The invariant everything else serves

> **`Agent.toBytes()` must emit byte-identical OOXML parts to the PHP engine.**

`tests/parity.test.ts` runs the PHP writer as a subprocess and diffs every part
for every fixture. That is the definition of done for any writer change. It
follows that:

- **Never build XML with a DOM or a serialiser on the write side.** Attribute
  order, self-closing style and the absence of inter-element whitespace are all
  part of the output. `helpers/xml.ts` is an escaper and the writer concatenates
  strings.
- **`docProps/core.xml` carries a `gmdate()` stamp** PHP offers no way to pin,
  so the two `<dcterms:*>` values are MASKED before comparison. The Python port
  records the same divergence in a ledger instead; both are honest, and neither
  should quietly grow a second entry.
- **The zip container is never compared and never can be.** PHP writes DEFLATE
  with real mtimes; this writes STORE with a fixed 1980 date. The comparison
  unzips both and diffs parts, which is the real contract anyway — a reader sees
  parts, never the compression.
- **`read()` is a PURE function of its bytes**, and that is a contract rather
  than an observation. The same package read twice — in the same second or a
  year apart, on any machine — returns an identical structure, down to every
  generated id, because consumers store reads and DIFF them: one clock- or
  RNG-derived field turns a diff of unchanged content into a whole-deck replace.
  The deck id is CRC-32 over the package's entries EXCEPT `docProps/core.xml`;
  an element whose `<p:cNvPr>` carries no `name` is numbered by its position in
  the file. Nothing on the read
  side may put the clock, a random number or the environment into a returned
  value. Guarded by `tests/reader-is-pure.test.ts`.

  Both parity suites used to DELETE the deck id before comparing, so neither
  could see this — a comparison that drops the field it cannot explain asserts
  nothing about it, and all three engines had the same bug, which a suite that
  only detects disagreement will never report.

  **Deriving it from the package is not the same as deriving it from the deck**,
  and 0.8.1 shipped the difference: the id was CRC-32 of the WHOLE package, and
  the package embeds a write-time stamp in `docProps/core.xml`. Two reads of one
  buffer still agreed — so every purity test passed — while a deck saved and
  re-read got a new id every time, which deterministically broke pptx version
  history in a consumer's product. The digest now skips that one entry, measured
  as the only one of 43 that a re-save changes. Its side effect is deliberate and
  pinned by a test: `<dc:title>` lives there too, so renaming a deck does not
  change its id.

- **A missing PHP is a FAILURE in CI, not a skip.** `describe.skipIf` made a
  runner without PHP indistinguishable from one where every part matched, and CI
  installed Node only, so the suite had never once executed. The throw at the
  bottom of `parity.test.ts` exists for that reason; do not soften it.

## Layout

```
src/
  agent.ts                  the public façade
  schema/                   schema · validator · repairer · types
  writer/pptx-writer.ts     string building; the byte contract lives here
  reader/pptx-reader.ts     a hand-rolled parser; best-effort, degrades
  table/table-resolver.ts   loose table element -> fully-decided cells
  table/composites.ts       kpiBand / metadataGrid -> a table element
  text/box-decoration.ts    a text box's fill, outline, radius, insets, accent bar
  helpers/                  xml · color · emu · markdown-inline · syntax-highlighter
                            · chart-translator
  zip/                      the vendored zip writer, reader and inflate
```

## The table model

`table/table-resolver.ts` is a **pure function**: a loose table element and a
theme in, a table whose every cell carries every decision out. The writer
serialises what it is handed.

Its output is in **points and 6-digit hex, never EMU**, deliberately — the same
decisions are what `last-word` needs for docx, and a model expressed in one
format's units cannot be shared. Pinned cross-language in `fancy-conformance`
as `dark-slide/table-cell-model`.

**Precedence is the design**, and it is the half byte parity cannot reach:

```
cell > row > column > band (header|stripe|body) > table > theme > default
```

**An absent key and a `false` key are different.** Absent falls through; `false`
STOPS the chain and means off. That is why the resolver tests key presence with
`in` rather than reaching for `??`, which passes the common case and fails every
"turn this one off" case.

## Traps

### 1. `<a:tcPr>` has a fixed child order

`lnL, lnR, lnT, lnB, …, fill`. Fill first parses fine and produces a file whose
**fill is dropped** by the reader.

### 2. `gridSpan` / `rowSpan` / `hMerge` / `vMerge` belong on `<a:tc>`

Not on `<a:tcPr>`. On `tcPr` they are well-formed and **silently ignored** — the
table renders unmerged with no error anywhere.

### 3. "No border" is STATED, never omitted

An absent `<a:lnL>` is an *unspecified* rule, not an absent one, and a reader
supplies its own default. LibreOffice draws a full grid over a table with no
line elements at all. Emit `<a:lnL><a:noFill/></a:lnL>`.

Same shape for shapes: `<a:ln w="0">` is a **hairline** everywhere, not an
absence. "No outline" is `<a:ln><a:noFill/></a:ln>`.

### 4. A left accent bar is a gradient, not a second shape

DrawingML has no per-side border on a shape. `<a:gradFill>` with two stops at
ADJACENT positions is a hard edge, so `box-decoration.ts` paints the bar and the
tint in ONE shape — no extra element, no z-order for the author to get right,
and no second shape id for the animation builder to renumber.

### 5. Every length is a design pixel, converted in ONE place

`helpers/design-units.ts` `DesignUnits.toPt()` is `px * 720 / designWidth`, where
`designWidth` is `theme.slideWidth ?? 1920` and 720 is the 10in slide in points.
`fontSize: 96` is 36pt, 5% of the slide width in PowerPoint and fancy-slides alike.

- It applies to every AUTHORED length: `fontSize` (floor 1pt), `strokeWidth`,
  `letterSpacing`, `spaceBefore`/`spaceAfter`, `padding`, `radius` (text boxes AND
  `rounded-rect` shapes, through the shared `roundRectGeometry`), border and
  accent-bar widths, table row heights, and the composites' own defaults.
- It does NOT apply to PowerPoint-native defaults nobody authored: the 7.2pt /
  3.6pt insets, a 1pt box outline, a 0.75pt table rule, 40pt / 30pt minimum rows,
  a 4pt accent bar, the 8pt gutter.
- Keep the operation order `px * 720 / width`, identical to PHP and Python. Every
  EMU and hundredths-of-a-point value is rounded from it, and the default canvas
  lands on exact ties (1px = 0.375pt = 4762.5 EMU) where a different order could
  cross a rounding boundary. `canvasDefaultLengths` in the parity suite pins them.
- `theme.aspectRatio` shapes the slide height (`DesignUnits.slideHeightEmu()`), so
  every Y conversion takes `this.slideHeightEmu`, never the 16:9 default; the
  reader parses `<p:sldSz>` for the same reason.
- A roundRect corner is `min(w, h) * adj / 100000` (LibreOffice's preset table).
  It used to divide by HALF the shorter side.

**Until 0.8 this was a halving** (`fontSize / 2`, 8pt floor) with every other
length taken as points. `theme.slideWidth: 1440` reproduces the old halving
exactly; the PHP reference fixture uses it with its former point lengths doubled.

### 6. `Math.round` is not PHP's `round`

PHP rounds half AWAY FROM ZERO; JS rounds half toward +∞. They agree on every
positive value, and every coordinate in a deck is positive, which is why this has
never bitten. It is recorded because the day a negative appears the divergence is
one EMU on an attribute nobody is looking at. The Python port carries an explicit
`php_round` for the same reason.

### 7. Composites are sugar and read back as their expansion

`kpiBand` and `metadataGrid` become a `table` in `buildElementXml` before
anything is serialised — no new OOXML, no new reader shape, and
`@particle-academy/fancy-slides` keeps a schema it can render. The cost is a
one-way loss: read a deck back and a composite is the table it became.

### 8. The reader must not assume a header row

Whether row 0 is a header is declared by `<a:tblPr firstRow="1">`. Assuming it
promoted a row of DATA to column labels and dropped it. Every `metadataGrid` and
`kpiBand` is a header-less table.

### 9. Divergences from PHP that are RULINGS, not bugs

Where the engines already disagree, the Python port follows PHP so the tally
stays 2-1 rather than becoming a three-way split. The live ones are listed in
`dark-slide-py/AGENTS.md`; do not "fix" one of them here without landing all
three.

## Embedded fonts (`src/fonts/`)

Opt-in through the write options (`fonts: { typeface: { variant: bytes } }`),
never through the deck: an agent names a face, the host supplies the licensed
file. Bytes only here (isomorphic); the PHP engine also accepts a path.

- **`.fntdata` is an EOT, not a `.ttf`.** Verified by rendering in LibreOffice 26:
  an uncompressed EOT renders the embedded face; the same font stored raw falls
  back. The opt-in render test (`DARK_SLIDE_RENDER=1`) checks this writer's
  output through LibreOffice.
- **Byte-identical to PHP**, header included (charset 1, NUL-terminated UTF-16LE
  names). The `embeddedFonts` parity case compares `.fntdata` as BYTES; the
  shared part comparison decodes only `.xml` / `.rels`, because a binary decoded
  through UTF-8 can read equal when it is not.
- **Refusals match PHP's text** and are collected and thrown together as
  `FontEmbeddingException` before anything is written.
- **No font supplied means no byte changes.** `embedTrueTypeFonts="1"` replaces
  `saveSubsetFonts="1"` only when a font is embedded.
- **PowerPoint and Google Slides are not verified.**
- Tests generate their own TrueType font (`tests/support/generated-font.ts`),
  byte-identical to PHP's `tests/Support/GeneratedFont`.

## Testing

```bash
npm ci
npm test                 # vitest: units + parity + reader parity
npx tsc --noEmit         # lint
```

The parity suites load `tests/fixtures/reference-deck.json` **from the PHP
repository** — via `DARK_SLIDE_PHP_SRC` or the sibling checkout — rather than
carrying a copy, so all three engines are compared on the same bytes instead of
on three transcriptions of the same intent.
