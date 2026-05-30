# Changelog

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
