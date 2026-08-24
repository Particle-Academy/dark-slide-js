import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, unzipSync } from "../src";

// Cross-engine parity: the PHP dark-slide and this TS port should emit
// byte-identical OOXML parts for the same deck. docProps/core.xml embeds a
// gmdate() timestamp that can't be pinned via the deck, so the two
// <dcterms:*> values are masked before comparison; every other part is
// compared byte-for-byte. Skips automatically when `php` isn't on PATH.

const PHP_SCRIPT = join(__dirname, "..", "scripts", "php-tobytes.php");

/**
 * The rich-constructs reference deck, loaded from the PHP repository rather
 * than transcribed here.
 *
 * It is the acceptance artifact for the whole trio — a nine-slide deck built
 * from the construct classes of a real paginated business document (metadata
 * grid, KPI band, accent-bar callouts, tables with a highlighted total row,
 * check-mark lists, a three-column comparison). Copying it into each repo
 * would give three fixtures that drift; this resolves the same file the PHP
 * sources are resolved from, so all three engines are compared on identical
 * input.
 */
function referenceDeck(): unknown | null {
  const srcRoot = process.env.DARK_SLIDE_PHP_SRC ?? join(__dirname, "..", "..", "dark-slide", "src");
  const file = join(srcRoot, "..", "tests", "fixtures", "reference-deck.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

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

// A 1x1 transparent PNG as a data URI (real bytes so getimagesize-style probes work).
const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

const SCHEMAS: Record<string, unknown> = {
  /**
   * Unicode through the markdown tokenizer and the syntax highlighter.
   *
   * The polyglot plan's §5 lists these two as a live PHP↔JS divergence — PHP
   * indexes by BYTE (strlen/substr), the port by UTF-16 code unit. Checked
   * against both engines, and it is NOT one: output is identical for CJK, emoji
   * (a surrogate pair on the JS side), combining marks and accented Latin. Both
   * loops only compare ASCII markers and cut at those positions, and neither a
   * UTF-8 continuation byte nor a UTF-16 surrogate can collide with ASCII. So
   * nothing was "fixed" here — working code was left alone.
   *
   * The fixture exists because the plan's FORWARD-looking half is right and the
   * agreement is incidental rather than designed. Rust's `&str` byte-slicing
   * panics on a non-char boundary, so a third implementation cannot inherit
   * this for free, and a well-meant tidy to mb_substr / Array.from on either
   * side would change the output with nothing to catch it. Now something does.
   */
  unicodeText: {
    id: "deck-unicode",
    title: "Unicode",
    metadata: META,
    theme: { name: "default", colors: { accent: "#8B5CF6" } },
    slides: [
      {
        id: "s1",
        layout: "content",
        elements: [
          {
            id: "e1",
            type: "text",
            x: 0.1,
            y: 0.1,
            w: 0.8,
            h: 0.4,
            content:
              "# \u65e5\u672c\u8a9e\u306e\u898b\u51fa\u3057\ncaf\u00e9 **bold** and na\u00efve `code`\n- \u592a\u5b57 **\u5f37\u8abf** \u3067\u3059\n- emoji \ud83c\udf89 **bold** end\n- a\u0301 combining mark",
            format: "markdown",
          },
          {
            id: "e2",
            type: "code",
            x: 0.1,
            y: 0.55,
            w: 0.8,
            h: 0.35,
            language: "php",
            code: '<?php $x = "caf\u00e9"; // \u65e5\u672c\u8a9e\n$emoji = "\ud83c\udf89";',
          },
        ],
      },
    ],
  },
  titleText: {
    id: "deck-title",
    title: "Title Deck",
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
  richSlide: {
    id: "deck-rich",
    title: "Rich Deck",
    metadata: META,
    theme: { name: "default", colors: { accent: "#EC4899", background: "#FFFFFF", text: "#111111" } },
    slides: [
      {
        id: "s1",
        layout: "title-content",
        background: { gradient: "linear-gradient(135deg, #fef3c7 0%, #fce7f3 100%)" },
        transition: { kind: "slide", direction: "left", duration: 600 },
        elements: [
          {
            id: "shp1",
            type: "shape",
            x: 0.05,
            y: 0.05,
            w: 0.4,
            h: 0.3,
            shape: "rounded-rect",
            fill: "rgba(139,92,246,0.4)",
            stroke: "#8B5CF6",
            strokeWidth: 3,
            dashed: true,
          },
          {
            id: "img1",
            type: "image",
            x: 0.5,
            y: 0.05,
            w: 0.4,
            h: 0.3,
            src: PNG_1x1,
            alt: "dot",
            fit: "contain",
          },
          {
            id: "code1",
            type: "code",
            x: 0.05,
            y: 0.4,
            w: 0.9,
            h: 0.3,
            code: "const x: number = 1;\nfunction add(a, b) { return a + b; }",
            language: "typescript",
          },
          {
            id: "tbl1",
            type: "table",
            x: 0.05,
            y: 0.72,
            w: 0.9,
            h: 0.2,
            columns: [
              { key: "name", label: "Name" },
              { key: "score", label: "Score" },
            ],
            rows: [
              { name: "Ada", score: 99 },
              { name: "Linus", score: 88 },
            ],
          },
          {
            id: "anim1",
            type: "text",
            x: 0.05,
            y: 0.92,
            w: 0.5,
            h: 0.06,
            content: "Line A\nLine B\nLine C",
            format: "markdown",
            href: "https://example.com",
            animation: { effect: "fly-in", direction: "left", byParagraph: true, duration: 400, order: 1 },
          },
        ],
      },
    ],
  },
  chartSlide: {
    id: "deck-chart",
    title: "Chart Deck",
    metadata: META,
    theme: { name: "default", colors: { accent: "#06B6D4" } },
    slides: [
      {
        id: "s1",
        layout: "blank",
        background: { color: "#0F172A" },
        elements: [
          {
            id: "c1",
            type: "chart",
            x: 0.1,
            y: 0.1,
            w: 0.8,
            h: 0.8,
            option: {
              title: { text: "Quarterly" },
              xAxis: { type: "category", data: ["Q1", "Q2", "Q3"] },
              yAxis: { type: "value" },
              series: [{ type: "bar", name: "Rev", data: [10, 20, 30] }],
            },
          },
        ],
      },
    ],
  },
  moreCharts: {
    id: "deck-charts2",
    title: "Charts2",
    metadata: META,
    theme: { name: "default", colors: { accent: "#F59E0B" } },
    slides: [
      {
        id: "s1",
        layout: "blank",
        elements: [
          {
            id: "line1",
            type: "chart",
            x: 0.05,
            y: 0.05,
            w: 0.45,
            h: 0.4,
            option: {
              xAxis: { type: "category", data: ["A", "B", "C"] },
              yAxis: { type: "value" },
              series: [
                { type: "line", name: "S1", data: [1, 2, 3], smooth: true },
                { type: "line", name: "S2", data: [3, 2, 1] },
              ],
            },
          },
          {
            id: "pie1",
            type: "chart",
            x: 0.5,
            y: 0.05,
            w: 0.45,
            h: 0.4,
            option: {
              series: [{ type: "pie", name: "Share", data: [{ name: "X", value: 5 }, { name: "Y", value: 7.5 }] }],
            },
          },
          {
            id: "scat1",
            type: "chart",
            x: 0.05,
            y: 0.5,
            w: 0.9,
            h: 0.45,
            option: {
              series: [
                {
                  type: "scatter",
                  name: "Pts",
                  data: [
                    [1, 2],
                    [3, 4.5],
                    [5, 6],
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  },
  imageFallback: {
    id: "deck-fallback",
    title: "Fallback",
    metadata: META,
    theme: { name: "default" },
    slides: [
      {
        id: "s1",
        layout: "blank",
        elements: [
          {
            id: "badimg",
            type: "image",
            x: 0.1,
            y: 0.1,
            w: 0.3,
            h: 0.3,
            src: "https://example.com/missing.png",
            alt: "remote",
          },
        ],
      },
    ],
  },
  multiNotes: {
    id: "deck-multi",
    title: "Multi Deck",
    metadata: META,
    theme: { name: "default" },
    slides: [
      {
        id: "s1",
        layout: "title",
        notes: "Speaker notes line one\nline two",
        elements: [
          { id: "t1", type: "text", x: 0.1, y: 0.4, w: 0.8, h: 0.2, content: "Slide One", format: "plain" },
        ],
      },
      {
        id: "s2",
        layout: "section-divider",
        transition: { kind: "fade", duration: 800 },
        elements: [
          {
            id: "t2",
            type: "text",
            x: 0.1,
            y: 0.4,
            w: 0.8,
            h: 0.2,
            content: "Slide Two",
            format: "plain",
            animation: { effect: "fade", duration: 300 },
          },
        ],
      },
    ],
  },
};

const CORE = "docProps/core.xml";

function maskCore(xml: string): string {
  return xml
    .replace(/<dcterms:created[^>]*>[^<]*<\/dcterms:created>/, "<dcterms:created>MASKED</dcterms:created>")
    .replace(/<dcterms:modified[^>]*>[^<]*<\/dcterms:modified>/, "<dcterms:modified>MASKED</dcterms:modified>");
}

const HAS_PHP = phpAvailable();

describe.skipIf(!HAS_PHP)("cross-engine parity (PHP vs TS)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "dark-slide-parity-"));
  });

  const REFERENCE = referenceDeck();
  if (REFERENCE !== null) {
    SCHEMAS.richConstructsReference = REFERENCE;
  } else if (process.env.CI) {
    throw new Error(
      "the rich-constructs reference deck was not found next to the PHP sources. " +
        "It is the acceptance artifact for every construct added in 0.7.0, and " +
        "without it this suite reports parity over the old features only.",
    );
  }

  for (const [name, schema] of Object.entries(SCHEMAS)) {
    it(`emits byte-identical OOXML parts: ${name}`, () => {
      const schemaFile = join(dir, `${name}.json`);
      const phpOut = join(dir, `${name}.php.pptx`);
      writeFileSync(schemaFile, JSON.stringify(schema));
      php([PHP_SCRIPT, schemaFile, phpOut]);

      const phpParts = unzipSync(new Uint8Array(readFileSync(phpOut)));
      const tsParts = unzipSync(Agent.toBytes(schema));

      expect(Object.keys(tsParts).sort()).toEqual(Object.keys(phpParts).sort());

      const dec = new TextDecoder();
      for (const part of Object.keys(phpParts)) {
        let phpText = dec.decode(phpParts[part]!);
        let tsText = dec.decode(tsParts[part]!);
        if (part === CORE) {
          phpText = maskCore(phpText);
          tsText = maskCore(tsText);
        }
        expect(tsText, `part ${part} differs`).toBe(phpText);
      }
    });
  }
});

/**
 * A missing PHP must never read as a pass.
 *
 * This suite is the cross-engine guarantee for the pptx pair — the only thing
 * asserting that the PHP and TS writers agree byte-for-byte. `skipIf` made a
 * runner without PHP indistinguishable from a runner where every part matched,
 * and CI installed Node only, so it had never once executed. Locally a skip is
 * still the right call; in CI it is a silent hole.
 */
if (process.env.CI && !HAS_PHP) {
  throw new Error(
    "php is not on PATH. This suite is the cross-engine parity guarantee; " +
      "skipping it in CI would report success with no coverage. " +
      "Install PHP 8.2+ and set DARK_SLIDE_PHP_SRC to the PHP package's src/.",
  );
}

if (!HAS_PHP) {
  // eslint-disable-next-line no-console
  console.warn("[parity] php not found on PATH — cross-engine tests skipped (local only; CI throws above).");
}
