import { describe, it, expect } from "vitest";
import { Agent, unzipSync } from "../../src";

// Ported from PHP tests/Unit/V04FeaturesTest.php. The PHP DOMDocument
// well-formedness guards are replaced with a lightweight balanced-tag check
// (isWellFormed); every substantive OOXML-substring assertion is ported verbatim.

const dec = new TextDecoder();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function v04Fixture(): Any {
  return {
    id: "v04",
    title: "v0.4 deck",
    theme: { name: "default", colors: { accent: "#8B5CF6" } },
    slides: [
      {
        id: "s1",
        layout: "title",
        elements: [{ id: "e1", type: "text", x: 0.1, y: 0.1, w: 0.8, h: 0.2, content: "Hello", format: "plain" }],
      },
    ],
  };
}

const V04_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function slideXml(deck: Any, part: string): string {
  const files = unzipSync(Agent.toBytes(deck));
  const f = files[part];
  return f ? dec.decode(f) : "";
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

function isWellFormed(xml: string): boolean {
  const stack: string[] = [];
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const closing = m[1] === "/";
    const selfClose = m[4] === "/";
    const name = m[2]!;
    if (selfClose) continue;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

describe("v0.4 features (ported PHP V04FeaturesTest)", () => {
  // ─── A) Transitions ─────────────────────────────────────────────────────
  it("emits a fade transition", () => {
    const deck = v04Fixture();
    deck.slides[0].transition = { kind: "fade", duration: 800 };
    const xml = slideXml(deck, "ppt/slides/slide1.xml");
    expect(xml).toContain('<p:transition spd="slow">');
    expect(xml).toContain("<p:fade/>");
  });

  it("emits a directional push for slide transitions", () => {
    for (const [dir, code] of Object.entries({ left: "l", right: "r", up: "u", down: "d" })) {
      const deck = v04Fixture();
      deck.slides[0].transition = { kind: "slide", direction: dir, duration: 200 };
      const xml = slideXml(deck, "ppt/slides/slide1.xml");
      expect(xml).toContain(`<p:push dir="${code}"/>`);
      expect(xml).toContain('spd="fast"');
    }
  });

  it("emits a zoom transition", () => {
    const deck = v04Fixture();
    deck.slides[0].transition = { kind: "zoom", duration: 400 };
    const xml = slideXml(deck, "ppt/slides/slide1.xml");
    expect(xml).toContain("<p:circle/>");
    expect(xml).toContain('spd="med"');
  });

  it("omits the transition element for kind none", () => {
    const deck = v04Fixture();
    deck.slides[0].transition = { kind: "none" };
    expect(slideXml(deck, "ppt/slides/slide1.xml")).not.toContain("<p:transition");
  });

  it("falls back to the deck default transition", () => {
    const deck = v04Fixture();
    deck.theme.defaultTransition = { kind: "fade", duration: 300 };
    expect(slideXml(deck, "ppt/slides/slide1.xml")).toContain("<p:fade/>");
  });

  // ─── B) Image fit / crop ────────────────────────────────────────────────
  it("emits a non-empty srcRect for fit cover", () => {
    const deck = v04Fixture();
    deck.slides[0].elements.push({
      id: "img",
      type: "image",
      x: 0.1,
      y: 0.1,
      w: 0.4,
      h: 0.4,
      src: V04_PNG,
      fit: "cover",
    });
    const xml = slideXml(deck, "ppt/slides/slide1.xml");
    expect(xml).toMatch(/<a:srcRect [^>]*\/>/);
    expect(xml).toMatch(/<a:srcRect l="0" t="[1-9]\d*" r="0" b="[1-9]\d*"\/>/);
  });

  it("shrinks the ext for fit contain (letterbox)", () => {
    const deck = v04Fixture();
    deck.slides[0].elements.push({
      id: "img",
      type: "image",
      x: 0.0,
      y: 0.0,
      w: 0.4,
      h: 0.4,
      src: V04_PNG,
      fit: "contain",
    });
    const xml = slideXml(deck, "ppt/slides/slide1.xml");
    expect(xml).toContain('<a:ext cx="2057400" cy="2057400"/>');
    expect(xml).not.toContain("<a:srcRect");
  });

  it("honours an explicit crop rect over fit", () => {
    const deck = v04Fixture();
    deck.slides[0].elements.push({
      id: "img",
      type: "image",
      x: 0.1,
      y: 0.1,
      w: 0.4,
      h: 0.4,
      src: V04_PNG,
      fit: "cover",
      crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 },
    });
    const xml = slideXml(deck, "ppt/slides/slide1.xml");
    expect(xml).toContain('<a:srcRect l="10000" t="20000" r="40000" b="30000"/>');
  });

  // ─── C) Charts ──────────────────────────────────────────────────────────
  it("emits a well-formed bar chart part with one ser per series", () => {
    const deck = v04Fixture();
    deck.slides[0].elements.push({
      id: "bar",
      type: "chart",
      x: 0.1,
      y: 0.4,
      w: 0.8,
      h: 0.5,
      option: {
        xAxis: { data: ["Q1", "Q2", "Q3"] },
        series: [
          { type: "bar", name: "Rev", data: [10, 20, 15] },
          { type: "bar", name: "Cost", data: [5, 8, 7] },
        ],
      },
    });
    const chart = slideXml(deck, "ppt/charts/chart1.xml");
    expect(chart).not.toBe("");
    expect(isWellFormed(chart)).toBe(true);
    expect(chart).toContain("<c:barChart>");
    expect(count(chart, "<c:ser>")).toBe(2);
    expect(chart).toContain("<c:strLit>");
    expect(chart).toContain("<c:numLit>");

    const slide = slideXml(deck, "ppt/slides/slide1.xml");
    expect(slide).toContain("<p:graphicFrame>");
    expect(slide).toContain('r:id="rIdChart1"');
  });

  it("emits a pie chart part", () => {
    const deck = v04Fixture();
    deck.slides[0].elements.push({
      id: "pie",
      type: "chart",
      x: 0.1,
      y: 0.4,
      w: 0.8,
      h: 0.5,
      option: {
        series: [
          {
            type: "pie",
            data: [
              { name: "A", value: 30 },
              { name: "B", value: 50 },
              { name: "C", value: 20 },
            ],
          },
        ],
      },
    });
    const chart = slideXml(deck, "ppt/charts/chart1.xml");
    expect(isWellFormed(chart)).toBe(true);
    expect(chart).toContain("<c:pieChart>");
    expect(count(chart, "<c:dPt>")).toBe(3);
    expect(chart).toContain("<c:v>A</c:v>");
  });

  it("registers a content-type override for chart parts", () => {
    const deck = v04Fixture();
    deck.slides[0].elements.push({
      id: "bar",
      type: "chart",
      x: 0.1,
      y: 0.4,
      w: 0.8,
      h: 0.5,
      option: { categories: ["a"], series: [{ type: "bar", data: [1] }] },
    });
    const ct = slideXml(deck, "[Content_Types].xml");
    expect(ct).toContain("/ppt/charts/chart1.xml");
    expect(ct).toContain("application/vnd.openxmlformats-officedocument.drawingml.chart+xml");
  });

  it("falls back to a placeholder for an untranslatable chart without crashing", () => {
    const deck = v04Fixture();
    deck.slides[0].elements.push({
      id: "bad",
      type: "chart",
      x: 0.1,
      y: 0.4,
      w: 0.8,
      h: 0.5,
      option: { title: { text: "Mystery" }, series: [{ type: "radar", data: [1, 2, 3] }] },
    });
    const slide = slideXml(deck, "ppt/slides/slide1.xml");
    expect(slideXml(deck, "ppt/charts/chart1.xml")).toBe("");
    expect(slide).toContain("<a:t>Mystery</a:t>");
    expect(slide).toContain('prst="roundRect"');
  });

  it("embeds a pre-rendered chart image when the option is untranslatable", () => {
    const deck = v04Fixture();
    deck.slides[0].elements.push({
      id: "preR",
      type: "chart",
      x: 0.1,
      y: 0.4,
      w: 0.8,
      h: 0.5,
      option: { series: "nonsense" },
      image: V04_PNG,
    });
    expect(slideXml(deck, "ppt/slides/slide1.xml")).toContain("<p:pic>");
  });

  // ─── D) Theme + layouts ─────────────────────────────────────────────────
  it("emits all eight slide layout parts", () => {
    const files = unzipSync(Agent.toBytes(v04Fixture()));
    for (let n = 1; n <= 8; n++) {
      expect(Object.keys(files), `missing layout ${n}`).toContain(`ppt/slideLayouts/slideLayout${n}.xml`);
    }
    expect(dec.decode(files["ppt/slideLayouts/slideLayout1.xml"]!)).toContain('type="blank"');
    expect(dec.decode(files["ppt/slideLayouts/slideLayout2.xml"]!)).toContain('type="title"');
  });

  it("points each slide at the layout matching its layout name", () => {
    const deck = v04Fixture();
    deck.slides.push({
      id: "s2",
      layout: "section-divider",
      elements: [{ id: "x", type: "text", x: 0.1, y: 0.1, w: 0.8, h: 0.2, content: "Section", format: "plain" }],
    });
    deck.slides.push({
      id: "s3",
      layout: "made-up",
      elements: [{ id: "y", type: "text", x: 0.1, y: 0.1, w: 0.8, h: 0.2, content: "Fallback", format: "plain" }],
    });
    expect(slideXml(deck, "ppt/slides/_rels/slide1.xml.rels")).toContain("slideLayout2.xml");
    expect(slideXml(deck, "ppt/slides/_rels/slide2.xml.rels")).toContain("slideLayout5.xml");
    expect(slideXml(deck, "ppt/slides/_rels/slide3.xml.rels")).toContain("slideLayout1.xml");
  });

  it("maps theme colors into the clrScheme", () => {
    const deck = v04Fixture();
    deck.theme.colors = {
      background: "#101820",
      text: "#F0F0F0",
      accent: "#FF6600",
      muted: "#445566",
      surface: "#223344",
    };
    const theme = slideXml(deck, "ppt/theme/theme1.xml");
    expect(theme).toContain('<a:lt1><a:srgbClr val="101820"/></a:lt1>');
    expect(theme).toContain('<a:dk1><a:srgbClr val="F0F0F0"/></a:dk1>');
    expect(theme).toContain('<a:accent1><a:srgbClr val="FF6600"/></a:accent1>');
    expect(theme).toContain('<a:dk2><a:srgbClr val="445566"/></a:dk2>');
    expect(theme).toContain('<a:lt2><a:srgbClr val="223344"/></a:lt2>');
  });
});
