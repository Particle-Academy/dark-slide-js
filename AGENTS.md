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

### 5. `fontSize` is HALVED into points, everywhere

`fancy-slides` designs against a 1920px width; PPTX renders ~720px at 10 inches.
`fontSize: 26` is 13pt. A schema-wide convention, not a table quirk.

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
