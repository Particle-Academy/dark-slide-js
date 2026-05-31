import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, SchemaException, unzipSync } from "../../src";

// Ported from PHP tests/Unit/AgentTest.php. PHP Agent::read takes a PATH; the TS
// Agent.read takes BYTES, so where PHP did write→read(path) we read the bytes
// directly (equivalent — both go through the same PptxReader).

const dec = new TextDecoder();
const dir = mkdtempSync(join(tmpdir(), "darkslide-agent-"));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function dsFixture(): Any {
  return {
    id: "test",
    title: "Test deck",
    theme: { name: "default" },
    slides: [
      {
        id: "s1",
        layout: "title",
        elements: [
          {
            id: "e1",
            type: "text",
            x: 0.1,
            y: 0.4,
            w: 0.8,
            h: 0.2,
            content: "Hello, DarkSlide.",
            format: "plain",
            style: { fontSize: 48, weight: "bold", align: "center" },
          },
        ],
        notes: "These are speaker notes.",
      },
      {
        id: "s2",
        layout: "blank",
        elements: [
          {
            id: "e2",
            type: "shape",
            shape: "rounded-rect",
            x: 0.2,
            y: 0.2,
            w: 0.6,
            h: 0.6,
            fill: "#8B5CF6",
            stroke: "#0F172A",
            strokeWidth: 4,
            radius: 16,
          },
        ],
      },
    ],
  };
}

const parts = (bytes: Uint8Array) => {
  const files = unzipSync(bytes);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) out[k] = dec.decode(v as Uint8Array);
  return out;
};

describe("agent (ported PHP AgentTest)", () => {
  it("validates a well-formed deck without errors", () => {
    expect(Agent.validate(dsFixture())).toEqual([]);
  });

  it("reports missing required keys with structured errors", () => {
    const errors = Agent.validate({ slides: [] });
    const paths = errors.map((e) => e.path);
    expect(paths).toContain("/id");
    expect(paths).toContain("/title");
    expect(paths).toContain("/theme");
  });

  it("flags bad coords on elements", () => {
    const deck = dsFixture();
    deck.slides[0].elements[0].x = "not-a-number";
    const errors = Agent.validate(deck);
    expect(errors).not.toHaveLength(0);
    expect(errors[0].path).toBe("/slides/0/elements/0/x");
  });

  it("repairs missing ids + clamps out-of-range coords", () => {
    const deck = {
      slides: [{ elements: [{ type: "text", x: -0.5, y: 1.5, w: 2.0, h: 0.001, content: "hi" }] }],
    };
    const result = Agent.validateAndRepair(deck);
    expect(result.ok).toBe(true);
    const element = (result.schema as Any).slides[0].elements[0];
    expect(element.x).toBe(0.0);
    expect(element.y).toBe(1.0);
    expect(element.w).toBe(1.0);
    expect(element.h).toBeGreaterThanOrEqual(0.02);
    expect(typeof element.id).toBe("string");
  });

  it("writes a pptx archive that is a valid zip", () => {
    const bytes = Agent.toBytes(dsFixture());
    expect(bytes.length).toBeGreaterThan(1000);
    expect([...bytes.subarray(0, 2)]).toEqual([0x50, 0x4b]); // "PK"
  });

  it("writes a pptx archive containing the expected parts", () => {
    const files = unzipSync(Agent.toBytes(dsFixture()));
    for (const name of [
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "docProps/app.xml",
      "ppt/presentation.xml",
      "ppt/_rels/presentation.xml.rels",
      "ppt/theme/theme1.xml",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideLayouts/slideLayout1.xml",
      "ppt/slides/slide1.xml",
      "ppt/slides/slide2.xml",
      "ppt/slides/_rels/slide1.xml.rels",
      "ppt/slides/_rels/slide2.xml.rels",
      "ppt/notesSlides/notesSlide1.xml",
    ]) {
      expect(Object.keys(files), `Missing part: ${name}`).toContain(name);
    }
  });

  it("embeds the text content inside slide1.xml", () => {
    expect(parts(Agent.toBytes(dsFixture()))["ppt/slides/slide1.xml"]).toContain("Hello, DarkSlide.");
  });

  it("writes the deck to disk and returns size + slide count", async () => {
    const path = join(dir, "out.pptx");
    const result = await Agent.write(dsFixture(), path);
    expect(result.slides).toBe(2);
    expect(result.bytes).toBeGreaterThan(1000);
    expect(existsSync(result.path)).toBe(true);
    expect(statSync(result.path).size).toBeGreaterThan(1000);
  });

  it("throws SchemaException when writing an invalid deck", () => {
    expect(() => Agent.toBytes({ slides: [] })).toThrow(SchemaException);
  });

  it("round-trips a deck through write → read", () => {
    const read = Agent.read(Agent.toBytes(dsFixture())) as Any;
    expect(read.title).toBe("Test deck");
    expect(read.slides.length).toBe(2);
    const first = read.slides[0];
    expect(first.elements.map((e: Any) => e.content)).toContain("Hello, DarkSlide.");
    expect(first.notes).toContain("speaker notes");
  });

  it("describes a deck in plain text", () => {
    const summary = Agent.describe(dsFixture());
    expect(summary).toContain("Deck: Test deck");
    expect(summary).toContain("Slides: 2");
    expect(summary).toContain("1 text");
    expect(summary).toContain("1 shape");
  });

  it("exports a JSON Schema with the deck top-level keys", () => {
    const schema = Agent.jsonSchema() as Any;
    expect(schema.type).toBe("object");
    expect(schema.required).toContain("id");
    expect(schema.required).toContain("title");
    expect(schema.required).toContain("slides");
    expect(schema.required).toContain("theme");
  });

  // ─── v0.2 features ───────────────────────────────────────────────────────
  it("renders inline markdown spans as separate drawingML runs", () => {
    const deck = dsFixture();
    deck.slides[0].elements[0].content = "A **bold** word and `code` and *italic* too.";
    deck.slides[0].elements[0].format = "markdown";
    const slide = parts(Agent.toBytes(deck))["ppt/slides/slide1.xml"]!;
    expect(slide).toContain("<a:t>A </a:t>");
    expect(slide).toContain("<a:t>bold</a:t>");
    expect(slide).toContain("<a:t> word and </a:t>");
    expect(slide).toContain("<a:t>code</a:t>");
    expect(slide).toContain("<a:t>italic</a:t>");
    expect(slide).toMatch(/<a:rPr[^>]*b="1"[^>]*>[\s\S]+?bold/);
    expect(slide).toContain("Consolas");
  });

  it("renders bulleted markdown lines with bullet paragraph markup", () => {
    const deck = dsFixture();
    deck.slides[0].elements[0].content = "- one\n- two with **bold**\n- three";
    deck.slides[0].elements[0].format = "markdown";
    const slide = parts(Agent.toBytes(deck))["ppt/slides/slide1.xml"]!;
    expect(slide.split('<a:buChar char="•"/>').length - 1).toBe(3);
  });

  it("emits a real <a:tbl> for table elements", () => {
    const deck = dsFixture();
    deck.slides[1].elements.push({
      id: "tbl1",
      type: "table",
      x: 0.1,
      y: 0.7,
      w: 0.8,
      h: 0.2,
      columns: [
        { key: "name", label: "Name" },
        { key: "qty", label: "Qty" },
      ],
      rows: [
        { name: "Widget", qty: 12 },
        { name: "Sprocket", qty: 4 },
      ],
    });
    const slide = parts(Agent.toBytes(deck))["ppt/slides/slide2.xml"]!;
    expect(slide).toContain("<a:tbl>");
    expect(slide).toContain("<a:tblGrid>");
    expect(slide.split("<a:tr ").length - 1).toBe(3);
    expect(slide).toContain("<a:t>Name</a:t>");
    expect(slide).toContain("<a:t>Widget</a:t>");
    expect(slide).toContain("<a:t>12</a:t>");
    expect(slide).not.toContain("[table]");
  });

  it("emits a gradient background as <a:gradFill> with stops", () => {
    const deck = dsFixture();
    deck.slides[0].background = { gradient: "linear-gradient(135deg, #fef3c7 0%, #fce7f3 100%)" };
    const slide = parts(Agent.toBytes(deck))["ppt/slides/slide1.xml"]!;
    expect(slide).toContain("<a:gradFill");
    expect(slide).toContain("<a:gsLst>");
    expect(slide).toContain("FEF3C7");
    expect(slide).toContain("FCE7F3");
    expect(slide).toContain("<a:lin ang=");
  });

  it("keeps solid colour bg working alongside gradient support", () => {
    const deck = dsFixture();
    deck.slides[0].background = { color: "#0b1220" };
    const slide = parts(Agent.toBytes(deck))["ppt/slides/slide1.xml"]!;
    expect(slide).toContain('<a:srgbClr val="0B1220"');
    expect(slide).not.toContain("<a:gradFill");
  });

  // ─── v0.3 features ───────────────────────────────────────────────────────
  it("renders markdown headings at larger sizes with bold runs", () => {
    const deck = dsFixture();
    deck.slides[0].elements[0].content = "# Big heading\n## Medium\n### Small\nbody copy";
    deck.slides[0].elements[0].format = "markdown";
    deck.slides[0].elements[0].style = { fontSize: 40 };
    const slide = parts(Agent.toBytes(deck))["ppt/slides/slide1.xml"]!;
    expect(slide).toContain("<a:t>Big heading</a:t>");
    expect(slide).toContain("<a:t>Medium</a:t>");
    expect(slide).toContain("<a:t>Small</a:t>");
    expect(slide).not.toContain("<a:t># Big heading</a:t>");
    expect(slide).toMatch(/<a:rPr[^>]*sz="3600"[^>]*b="1"[^>]*>[\s\S]{0,200}?Big heading/);
    expect(slide).toMatch(/<a:rPr[^>]*sz="2000"[^>]*>[\s\S]{0,200}?body copy/);
  });

  it("highlights code blocks with colored token runs", () => {
    const deck = dsFixture();
    deck.slides[1].elements.push({
      id: "snippet",
      type: "code",
      x: 0.05,
      y: 0.05,
      w: 0.9,
      h: 0.4,
      code: "const greet = (name) => `Hello, ${name}`;\n// comment",
      language: "typescript",
    });
    const slide = parts(Agent.toBytes(deck))["ppt/slides/slide2.xml"]!;
    expect(slide).toMatch(/<a:srgbClr val="C084FC"\/>[\s\S]{0,200}?<a:t>const<\/a:t>/);
    expect(slide).toMatch(/<a:srgbClr val="64748B"\/>[\s\S]{0,200}?<a:t>\/\/ comment<\/a:t>/);
    expect(slide).toContain("86EFAC");
    expect(slide).toContain("Consolas");
  });

  it("round-trips a table through write → read", () => {
    const deck = dsFixture();
    deck.slides[1].elements.push({
      id: "tbl-rt",
      type: "table",
      x: 0.1,
      y: 0.7,
      w: 0.8,
      h: 0.2,
      columns: [
        { key: "name", label: "Name" },
        { key: "qty", label: "Qty" },
      ],
      rows: [
        { name: "Widget", qty: 12 },
        { name: "Sprocket", qty: 4 },
      ],
    });
    const read = Agent.read(Agent.toBytes(deck)) as Any;
    const tables = read.slides[1].elements.filter((e: Any) => e.type === "table");
    expect(tables.length).toBe(1);
    const t = tables[0];
    expect(t.columns.map((c: Any) => c.label)).toEqual(["Name", "Qty"]);
    expect(t.rows.length).toBe(2);
    expect(Object.values(t.rows[0])).toEqual(["Widget", "12"]);
  });

  it("round-trips a gradient background through write → read", () => {
    const deck = dsFixture();
    deck.slides[0].background = { gradient: "linear-gradient(135deg, #fef3c7 0%, #fce7f3 100%)" };
    const read = Agent.read(Agent.toBytes(deck)) as Any;
    const bg = read.slides[0].background;
    expect(bg).toBeTypeOf("object");
    expect(bg).toHaveProperty("gradient");
    expect(bg.gradient).toContain("linear-gradient(");
    expect(String(bg.gradient).toLowerCase()).toContain("#fef3c7");
    expect(String(bg.gradient).toLowerCase()).toContain("#fce7f3");
  });

  it("round-trips an embedded image as a data URI", () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const deck = dsFixture();
    deck.slides[0].elements.push({
      id: "img",
      type: "image",
      x: 0.1,
      y: 0.1,
      w: 0.3,
      h: 0.3,
      src: png,
      fit: "cover",
    });
    const read = Agent.read(Agent.toBytes(deck)) as Any;
    const images = read.slides[0].elements.filter((e: Any) => e.type === "image");
    expect(images.length).toBe(1);
    const src = images[0].src as string;
    expect(src.startsWith("data:image/png;base64,")).toBe(true);
    expect(src.length).toBeGreaterThan(100);
  });

  it("round-trips inline markdown spans through write → read", () => {
    const deck = dsFixture();
    deck.slides[0].elements[0].content = "This is **bold** and *italic* and `code`.";
    deck.slides[0].elements[0].format = "markdown";
    deck.slides[0].elements[0].style = { fontSize: 24, align: "left" };
    const read = Agent.read(Agent.toBytes(deck)) as Any;
    const first = read.slides[0].elements.find((e: Any) => e.type === "text");
    expect(first.format).toBe("markdown");
    expect(first.content).toContain("**bold**");
    expect(first.content).toContain("*italic*");
    expect(first.content).toContain("`code`");
  });
});
