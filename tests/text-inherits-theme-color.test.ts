import { describe, expect, it } from "vitest";
import { unzipSync } from "../src";
import { PptxWriter } from "../src/writer/pptx-writer";

/**
 * Text with no colour of its own takes the THEME's text colour.
 *
 * fancy-slides draws `style.color ?? theme.colors.text`; the writer used
 * `style.color ?? #0F172A`. On a dark theme every unstyled text box was
 * near-black on a dark background: the deck previewed correctly and exported
 * with no visible text. The same test runs in all three engines.
 */
type Any = Record<string, unknown>;

function slideXml(theme: Any, style?: Any): string {
  const deck = {
    id: "tic",
    title: "Theme text colour",
    theme: { name: "tic", ...theme },
    slides: [{ id: "s1", elements: [{
      id: "e", type: "text", x: 0.1, y: 0.4, w: 0.8, h: 0.2,
      content: "Headline\n\n- **bold** point", format: "markdown",
      ...(style ? { style } : {}),
    }] }],
  };
  const files = unzipSync(new PptxWriter().toBytes(deck as never));
  return new TextDecoder().decode(files["ppt/slides/slide1.xml"]!);
}

const dark = { colors: { background: "#101828", text: "#F9FAFB" } };

describe("unstyled text colour", () => {
  it("is the theme text colour", () => {
    const xml = slideXml(dark);
    expect(xml).toContain('<a:srgbClr val="F9FAFB"/>');
    expect(xml).not.toContain('<a:srgbClr val="0F172A"/>');
  });

  it("still loses to an element colour", () => {
    const xml = slideXml(dark, { color: "#F97316" });
    expect(xml).toContain('<a:srgbClr val="F97316"/>');
    expect(xml).not.toContain('<a:srgbClr val="F9FAFB"/>');
  });

  it("keeps the old default when the theme names no text colour", () => {
    expect(slideXml({})).toContain('<a:srgbClr val="0F172A"/>');
  });
});

describe("tables on a dark theme", () => {
  it("colours table text and stripes from the theme, so a dark deck can read its table", () => {
    const deck = {
      id: "t", title: "T",
      theme: { name: "dark", colors: { background: "#0B1220", text: "#F9FAFB", accent: "#38BDF8" } },
      slides: [{ id: "s1", elements: [{
        id: "tb", type: "table", x: 0.1, y: 0.2, w: 0.8, h: 0.5,
        columns: [{ key: "k", label: "KPI" }, { key: "v", label: "Actual" }],
        rows: [{ k: "On-time", v: "94.2%" }, { k: "Damage", v: "0.6%" }],
      }] }],
    };
    const xml = new TextDecoder().decode(unzipSync(new PptxWriter().toBytes(deck as never))["ppt/slides/slide1.xml"]!);
    expect(xml).not.toContain('val="0F172A"');
    expect(xml).not.toContain('val="F8FAFC"');
    expect(xml).toContain('<a:srgbClr val="F9FAFB"/>');
  });
});
