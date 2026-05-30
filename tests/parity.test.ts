import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, unzipSync } from "../src";

// Cross-engine parity: the PHP dark-slide and this TS port should emit
// byte-identical OOXML parts for the same deck. docProps/core.xml embeds a
// gmdate() timestamp that can't be pinned via the deck, so the two
// <dcterms:*> values are masked before comparison; every other part is
// compared byte-for-byte. Skips automatically when `php` isn't on PATH.

const PHP_SCRIPT = join(__dirname, "..", "scripts", "php-tobytes.php");

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

if (!HAS_PHP) {
  // eslint-disable-next-line no-console
  console.warn("[parity] php not found on PATH — cross-engine parity tests skipped.");
}
