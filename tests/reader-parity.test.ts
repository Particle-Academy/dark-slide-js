import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "../src";

// Cross-engine READER parity: for the same .pptx file, the PHP dark-slide
// reader (scripts/php-read.php) and this TS port's reader should recover the
// SAME deck schema. We generate each file with the TS writer (Agent.toBytes),
// hand it to the PHP reader (capturing its JSON), and structurally compare to
// the TS reader's output.
//
// PHP/JSON ambiguity: PHP json_encode serializes an empty associative array as
// `[]` not `{}`, escapes `/` as `\/`, and may key-order differently. So we do a
// STRUCTURAL deep compare with a normalize() that:
//   - treats empty [] and empty {} as equal,
//   - sorts object keys,
//   - compares numbers by value.
// The deck `id` carries a random hex suffix on import (`imported-<rand>`), so it
// is excluded from the comparison; everything substantive (element types,
// geometry, text, table contents, background, notes, image data) is compared.
//
// Skips automatically when `php` isn't on PATH.

const PHP_SCRIPT = join(__dirname, "..", "scripts", "php-read.php");

function php(args: string[], opts: Parameters<typeof execFileSync>[2] = {}): Buffer {
  return execFileSync("php", args, { shell: true, ...opts }) as Buffer;
}

function phpAvailable(): boolean {
  try {
    php(["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const META = { author: "Parity" };

// A 1x1 transparent PNG as a data URI.
const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

const SCHEMAS: Record<string, unknown> = {
  textMarkdown: {
    id: "deck-text",
    title: "Text Deck",
    metadata: META,
    theme: { name: "default", colors: { accent: "#8B5CF6" } },
    slides: [
      {
        id: "s1",
        layout: "title",
        elements: [
          {
            id: "e1",
            type: "text",
            x: 0.1,
            y: 0.3,
            w: 0.8,
            h: 0.4,
            content: "# Heading\nSome **bold** and `code` text\n- bullet one\n- bullet two",
            format: "markdown",
            style: { fontSize: 48, align: "center", color: "#0F172A", weight: "bold" },
          },
        ],
      },
    ],
  },
  shapeSlide: {
    id: "deck-shape",
    title: "Shape Deck",
    metadata: META,
    theme: { name: "default" },
    slides: [
      {
        id: "s1",
        layout: "blank",
        elements: [
          {
            id: "shp1",
            type: "shape",
            x: 0.05,
            y: 0.05,
            w: 0.4,
            h: 0.3,
            shape: "rounded-rect",
            fill: "#8B5CF6",
          },
          { id: "shp2", type: "shape", x: 0.5, y: 0.5, w: 0.3, h: 0.3, shape: "ellipse", fill: "#FF0000" },
        ],
      },
    ],
  },
  tableSlide: {
    id: "deck-table",
    title: "Table Deck",
    metadata: META,
    theme: { name: "default" },
    slides: [
      {
        id: "s1",
        layout: "blank",
        elements: [
          {
            id: "tbl1",
            type: "table",
            x: 0.05,
            y: 0.1,
            w: 0.9,
            h: 0.4,
            columns: [
              { key: "name", label: "Name" },
              { key: "score", label: "Score" },
            ],
            rows: [
              { name: "Ada", score: "99" },
              { name: "Linus", score: "88" },
            ],
          },
        ],
      },
    ],
  },
  solidBg: {
    id: "deck-solid",
    title: "Solid Bg",
    metadata: META,
    theme: { name: "default" },
    slides: [{ id: "s1", layout: "blank", background: { color: "#123456" }, elements: [] }],
  },
  gradientBg: {
    id: "deck-grad",
    title: "Gradient Bg",
    metadata: META,
    theme: { name: "default" },
    slides: [
      {
        id: "s1",
        layout: "blank",
        background: { gradient: "linear-gradient(90deg, #ff0000 0%, #00ff00 100%)" },
        elements: [],
      },
    ],
  },
  notesSlide: {
    id: "deck-notes",
    title: "Notes Deck",
    metadata: META,
    theme: { name: "default" },
    slides: [
      {
        id: "s1",
        layout: "title",
        notes: "Speaker notes line one\nline two",
        elements: [{ id: "t1", type: "text", x: 0.1, y: 0.4, w: 0.8, h: 0.2, content: "Slide One", format: "plain" }],
      },
    ],
  },
  imageSlide: {
    id: "deck-image",
    title: "Image Deck",
    metadata: META,
    theme: { name: "default" },
    slides: [
      {
        id: "s1",
        layout: "blank",
        elements: [{ id: "img1", type: "image", x: 0.1, y: 0.1, w: 0.2, h: 0.2, src: PNG_1x1, alt: "dot", fit: "contain" }],
      },
    ],
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isEmpty = (v: unknown): boolean =>
  (Array.isArray(v) && v.length === 0) || (isPlainObject(v) && Object.keys(v).length === 0);

/**
 * Normalize a parsed-JSON tree for cross-engine structural comparison:
 *   - empty [] and empty {} collapse to the same sentinel,
 *   - object keys are sorted,
 *   - numbers compare by value (already the case once parsed),
 *   - the deck-level `id` (random `imported-<hex>`) is stripped.
 */
function normalize(value: Any): Any {
  if (isEmpty(value)) return "∅empty";
  if (Array.isArray(value)) return value.map(normalize);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalize(value[key]);
    }
    return out;
  }
  return value;
}

/** Strip the random import id so the two engines' nondeterministic ids don't diverge. */
function stripVolatileIds(deck: Any): Any {
  const clone = JSON.parse(JSON.stringify(deck));
  delete clone.id;
  return clone;
}

const HAS_PHP = phpAvailable();

describe.skipIf(!HAS_PHP)("cross-engine reader parity (PHP vs TS)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "dark-slide-reader-parity-"));
  });

  for (const [name, schema] of Object.entries(SCHEMAS)) {
    it(`readers agree on deck content: ${name}`, () => {
      const bytes = Agent.toBytes(schema);
      const pptxFile = join(dir, `${name}.pptx`);
      writeFileSync(pptxFile, bytes);

      const phpJson = php([PHP_SCRIPT, pptxFile]).toString("utf8");
      const phpDeck = JSON.parse(phpJson);
      const tsDeck = Agent.read(bytes);

      expect(normalize(stripVolatileIds(tsDeck))).toEqual(normalize(stripVolatileIds(phpDeck)));
    });
  }
});

if (!HAS_PHP) {
  // eslint-disable-next-line no-console
  console.warn("[reader-parity] php not found on PATH — cross-engine reader parity tests skipped.");
}
