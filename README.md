# @particle-academy/dark-slide

[![Fancy UI suite](art/fancy-ui.svg)](https://particle.academy)

Zero-dependency, **isomorphic** (browser + Node) `.pptx` writer + reader for
agentic deck creation. The Node/TypeScript mirror of the PHP
[`particle-academy/dark-slide`](https://github.com/Particle-Academy/dark-slide)
— same deck schema in, same `.pptx` out (feature-parity with PHP 0.5.2).

The deck schema is identical to
[`@particle-academy/fancy-slides`](https://github.com/Particle-Academy/fancy-slides),
so a `fancy-slides` DeckEditor deck exports to PowerPoint with no translation —
in the browser or in Node.

```ts
import { Agent } from "@particle-academy/dark-slide";

const deck = {
  id: "d1",
  title: "Quarterly Review",
  theme: { name: "default" },
  slides: [
    {
      id: "s1",
      layout: "title",
      elements: [
        { id: "t1", type: "text", x: 0.1, y: 0.4, w: 0.8, h: 0.2, content: "# Q3 Results" },
      ],
    },
  ],
};

const bytes: Uint8Array = Agent.toBytes(deck); // universal
await Agent.write(deck, "deck.pptx"); // Node only
```

## API

`Agent` (static) mirrors the PHP surface:

- `validate(deck)` → structured errors `{path, expected, got, value, hint}[]`
- `validateAndRepair(deck)` → `{ok, schema, errors}`
- `toBytes(deck, opts?)` → `Uint8Array` (universal)
- `write(deck, path, opts?)` → `{path, bytes, slides}` (Node only)
- `read(bytes)` / `fromBytes(bytes)` → deck schema (universal)
- `describe(deck)` → plain-text summary
- `jsonSchema()` → JSON Schema for LLM tool-use

Coordinates are `0..1` fractions of the slide; text supports inline markdown
(`**bold**`, `*italic*`, `` `code` ``, `#`/`##`/`###` headings, `[label](url)`).
