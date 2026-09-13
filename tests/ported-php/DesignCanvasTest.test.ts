import { describe, it, expect } from "vitest";
import { Agent, unzipSync } from "../../src";

// Ported from PHP tests/Unit/DesignCanvasTest.php (Layout has no port here) and
// the exact rounded-corner cases from RichTextConstructsTest.php.
//
// The deck's design canvas maps onto the slide the way fancy-slides maps it.
// Before 0.8 the same `fontSize` was scaled three ways: fancy-slides drew 96 as
// 5.0% of the slide width, this writer halved it on a 720pt slide (6.7%), and
// the PHP shrink-to-fit estimated on 1280 (7.5%). `theme.aspectRatio` was
// accepted and ignored, so a 4:3 deck came out stretched onto 16:9.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const dec = new TextDecoder();

function dcDeck(theme: Any, element: Any): Any {
  return {
    id: "canvas",
    title: "Design canvas",
    theme: { name: "canvas", ...theme },
    slides: [
      {
        id: "s1",
        elements: [{ id: "e", type: "text", x: 0.1, y: 0.5, w: 0.5, h: 0.25, content: "Canvas", ...element }],
      },
    ],
  };
}

function dcParts(deck: Any): { slide: string; presentation: string } {
  const parts = unzipSync(Agent.toBytes(deck));
  return { slide: dec.decode(parts["ppt/slides/slide1.xml"]!), presentation: dec.decode(parts["ppt/presentation.xml"]!) };
}

describe("design canvas", () => {
  it("keeps a font size at the same share of the slide as fancy-slides draws it", () => {
    // 96 of 1920 is 5% of the width; 5% of a 720pt slide is 36pt.
    expect(dcParts(dcDeck({}, { style: { fontSize: 96 } })).slide).toContain('sz="3600"');
    // Half the canvas, twice the share.
    expect(dcParts(dcDeck({ slideWidth: 960 }, { style: { fontSize: 96 } })).slide).toContain('sz="7200"');
  });

  it("reproduces the sizes dark-slide wrote before 0.8 with slideWidth 1440", () => {
    // 720 / 1440 is the old halving, so text and every length land where 0.7 put them.
    const slide = dcParts(dcDeck({ slideWidth: 1440 }, { style: { fontSize: 96, letterSpacing: 4, padding: 24 } })).slide;

    expect(slide).toContain('sz="4800"'); // 48pt, as 0.7 halved it
    expect(slide).toContain('spc="200"'); // 2pt
    expect(slide).toContain('lIns="152400"'); // 12pt
  });

  it("scales a shape outline with the canvas", () => {
    const shape = { type: "shape", shape: "rect", strokeWidth: 8 };

    expect(dcParts(dcDeck({}, shape)).slide).toContain('<a:ln w="38100">'); // 3pt
    expect(dcParts(dcDeck({ slideWidth: 1440 }, shape)).slide).toContain('<a:ln w="50800">'); // 4pt
  });

  it.each([
    // It used to ignore `radius` and write an empty avLst, PowerPoint's default corner.
    ["fancy-slides default 8px = 3pt", null, 3704],
    ["64px = 24pt", 64, 29630],
    ["larger than the box is a pill, not an overflow", 4000, 50000],
  ])("rounds a rounded-rect shape by its radius in design pixels: %s", (_label, radius, adj) => {
    // A 0.3 x 0.2 box on a 16:9 slide: 2743200 x 1028700 EMU, shorter side 1028700.
    // The corner radius is min(w, h) * adj / 100000, so adj = radiusEmu / 1028700 * 100000.
    const shape: Any = { type: "shape", shape: "rounded-rect", w: 0.3, h: 0.2 };
    if (radius !== null) shape.radius = radius;

    expect(dcParts(dcDeck({}, shape)).slide).toContain(
      `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`,
    );
  });

  it("rounds a decorated text box by min(w, h), not half of it", () => {
    // The PHP rich-text fixture box: 0.88 x 0.18 of a 16:9 slide, shorter side
    // 925830 EMU; 8 design px is 3pt = 38100 EMU; 38100 / 925830 * 100000 = 4115.
    // The old formula divided by HALF the shorter side and drew every corner
    // twice as round.
    const slide = dcParts(dcDeck({}, { x: 0.06, y: 0.2, w: 0.88, h: 0.18, style: { fill: "#E8F2F3", radius: 8 } })).slide;

    expect(slide).toContain('<a:gd name="adj" fmla="val 4115"/>');
  });

  it.each([
    ["16:9 (default)", 16 / 9, '<p:sldSz cx="9144000" cy="5143500" type="screen16x9"/>', 2571750],
    ["16:10", 16 / 10, '<p:sldSz cx="9144000" cy="5715000" type="screen16x10"/>', 2857500],
    ["4:3", 4 / 3, '<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>', 3429000],
    ["custom 2:1", 2.0, '<p:sldSz cx="9144000" cy="4572000"/>', 2286000],
  ])("shapes the slide by theme.aspectRatio instead of always writing 16:9: %s", (_label, ratio, sldSz, yEmu) => {
    const parts = dcParts(dcDeck({ aspectRatio: ratio }, {}));

    expect(parts.presentation).toContain(sldSz);
    // y 0.5 is the middle of THIS slide's height, not of a 16:9 one.
    expect(parts.slide).toContain(`<a:off x="914400" y="${yEmu}"/>`);
  });

  it("reads a non-16:9 deck back with its own geometry and aspect ratio", () => {
    const deck = Agent.read(Agent.toBytes(dcDeck({ aspectRatio: 4 / 3 }, {}))) as Any;

    // The reader used to convert against a 16:9 height, reading y 0.5 of a 4:3
    // slide back as 0.667.
    expect(deck.slides[0].elements[0].y).toBe(0.5);
    expect(deck.slides[0].elements[0].h).toBe(0.25);
    expect(deck.theme.aspectRatio).toBe(4 / 3);
  });

  it("reads a 16:9 deck back without inventing an aspect ratio", () => {
    const deck = Agent.read(Agent.toBytes(dcDeck({}, {}))) as Any;

    expect(deck.theme).not.toHaveProperty("aspectRatio");
  });

  it("writes a deck with no aspectRatio exactly as 16:9", () => {
    expect(dcParts(dcDeck({}, {})).presentation).toContain('<p:sldSz cx="9144000" cy="5143500" type="screen16x9"/>');
  });

  it("converts table lengths as design pixels and keeps the unstated defaults in points", () => {
    const table = {
      type: "table",
      columns: [{ key: "a", label: "A" }],
      rows: [{ cells: { a: "1" }, height: 128 }],
      style: { padding: { left: 32 }, borders: { width: 8 }, header: { letterSpacing: 8 } },
    };
    const slide = dcParts(dcDeck({}, table)).slide;

    expect(slide).toContain('marL="152400"'); // stated 32px = 12pt
    expect(slide).toContain('marT="45720"'); // unstated: PowerPoint's 3.6pt
    expect(slide).toContain('<a:lnL w="38100"'); // stated 8px = 3pt
    expect(slide).toContain('spc="300"'); // stated 8px = 3pt
    expect(slide).toContain('<a:tr h="609600">'); // stated 128px = 48pt
    expect(slide).toContain('sz="1050"'); // default 28px = 10.5pt
  });

  it("sizes a code block from style.fontSize, defaulting to the 12pt it was fixed at", () => {
    const code = { type: "code", language: "js", code: "const x = 1;" };

    expect(dcParts(dcDeck({}, code)).slide).toContain('sz="1200"'); // 32px default
    expect(dcParts(dcDeck({}, { ...code, style: { fontSize: 48 } })).slide).toContain('sz="1800"');
  });
});
