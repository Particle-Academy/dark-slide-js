import { describe, expect, it } from "vitest";
import { Agent, unzipSync } from "../src";

/**
 * A deck read back keeps the styling it was written with. Mirrors PHP
 * tests/Unit/ReaderKeepsStylingTest.php case for case.
 *
 * The reader used to return geometry and text only, so an agent editing a
 * branded deck (read, change one slide, write) shipped the whole deck in 28px
 * default text, default colours and a purple tint on every panel.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function rksDeck(): Any {
  return {
    id: "rks",
    title: "Styled",
    theme: {
      name: "brand",
      colors: { background: "#101828", text: "#F9FAFB", accent: "#F97316", muted: "#94A3B8", surface: "#1E293B" },
      fonts: { heading: "Playfair Display", body: "Inter" },
    },
    slides: [
      {
        id: "s1",
        elements: [
          { id: "title", type: "text", x: 0.06, y: 0.08, w: 0.88, h: 0.2, content: "EMEA led Q3",
            style: { fontSize: 88, weight: 700, fontFamily: "Playfair Display", color: "#F97316", align: "center" } },
          { id: "body", type: "text", x: 0.06, y: 0.35, w: 0.5, h: 0.3, content: "Revenue grew 31%",
            style: { fontSize: 40, italic: true, verticalAlign: "middle", align: "right" } },
          { id: "plain", type: "text", x: 0.06, y: 0.7, w: 0.5, h: 0.1, content: "Unstyled" },
          { id: "panel", type: "shape", shape: "rounded-rect", x: 0.6, y: 0.35, w: 0.34, h: 0.3, fill: "#1E293B", stroke: "transparent" },
          { id: "tint", type: "shape", shape: "rect", x: 0.6, y: 0.7, w: 0.34, h: 0.1 },
          { id: "rule", type: "shape", shape: "rect", x: 0.06, y: 0.3, w: 0.1, h: 0.006,
            fill: "#F97316", stroke: "#F97316", strokeWidth: 4, dashed: true },
        ],
      },
    ],
  };
}

function rksParts(bytes: Uint8Array): Record<string, string> {
  const files = unzipSync(bytes);
  const dec = new TextDecoder();
  return {
    slide: dec.decode(files["ppt/slides/slide1.xml"]!),
    theme: dec.decode(files["ppt/theme/theme1.xml"]!),
  };
}

const read = (deck: Any): Any => Agent.read(Agent.toBytes(deck));
const byId = (deck: Any): Record<string, Any> =>
  Object.fromEntries(deck.slides[0].elements.map((e: Any) => [e.id, e]));

describe("the reader keeps styling", () => {
  it("reads the theme back: colours and fonts", () => {
    expect(read(rksDeck()).theme).toStrictEqual({
      name: "imported",
      colors: { background: "#101828", text: "#F9FAFB", accent: "#F97316", muted: "#94A3B8", surface: "#1E293B" },
      fonts: { heading: "Playfair Display", body: "Inter" },
    });
  });

  it("reads a text element style back in design pixels", () => {
    const els = byId(read(rksDeck()));
    // JSON pins key ORDER too, which PHP's toBe does.
    expect(JSON.stringify(els.title.style)).toBe(
      JSON.stringify({ fontSize: 88, weight: 700, color: "#F97316", fontFamily: "Playfair Display", align: "center" }),
    );
    expect(JSON.stringify(els.body.style)).toBe(
      JSON.stringify({ fontSize: 40, italic: true, color: "#F9FAFB", align: "right", verticalAlign: "middle" }),
    );
    expect(JSON.stringify(els.plain.style)).toBe(JSON.stringify({ fontSize: 28, color: "#F9FAFB" }));
  });

  it('reads shape fill and outline back, including "none"', () => {
    const els = byId(read(rksDeck()));
    expect(els.panel).toMatchObject({ fill: "#1E293B", stroke: "transparent" });
    expect(els.tint).toMatchObject({ fill: "rgba(139,92,246,0.15)", stroke: "#F97316", strokeWidth: 2 });
    expect(els.rule).toMatchObject({ fill: "#F97316", stroke: "#F97316", strokeWidth: 4, dashed: true });
  });

  it("keeps a bold paragraph bold inside an otherwise plain box", () => {
    const deck = rksDeck();
    deck.slides[0].elements = [
      { id: "mix", type: "text", x: 0.1, y: 0.1, w: 0.8, h: 0.4, content: "**Lead line**\nPlain detail", format: "markdown" },
    ];
    const el = read(deck).slides[0].elements[0];
    expect(el.content).toBe("**Lead line**\nPlain detail");
    expect(el.format).toBe("markdown");
    expect(el.style).not.toHaveProperty("weight");
  });

  it("reports a named mono face, and not the default one", () => {
    const deck = rksDeck();
    deck.theme.fonts.mono = "Fira Code";
    expect(read(deck).theme.fonts.mono).toBe("Fira Code");
  });

  it("writes what it read to the same slide and theme parts", () => {
    const original = rksParts(Agent.toBytes(rksDeck()));
    const again = rksParts(Agent.toBytes(read(rksDeck())));
    expect(again.theme).toBe(original.theme);
    expect(again.slide).toBe(original.slide);
  });
});
