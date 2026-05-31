import { describe, it, expect } from "vitest";
import { Agent, unzipSync } from "../../src";

// Ported from PHP tests/Unit/HyperlinkTest.php.

const dec = new TextDecoder();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function part(deck: Any, name: string): string {
  const files = unzipSync(Agent.toBytes(deck));
  const f = files[name];
  return f ? dec.decode(f) : "";
}

function hlinkDeck(href: string): Any {
  return {
    id: "hl",
    title: "hyperlink deck",
    theme: { name: "default" },
    slides: [
      {
        id: "s1",
        layout: "blank",
        elements: [
          { id: "btn", type: "shape", shape: "rounded-rect", x: 0.1, y: 0.1, w: 0.3, h: 0.15, fill: "#8B5CF6", href },
          { id: "plain", type: "text", x: 0.1, y: 0.4, w: 0.5, h: 0.1, content: "no link", format: "plain" },
        ],
      },
    ],
  };
}

describe("hyperlink (ported PHP HyperlinkTest)", () => {
  it("injects an <a:hlinkClick> into the cNvPr of an element with href", () => {
    const xml = part(hlinkDeck("https://particle.academy/fancy"), "ppt/slides/slide1.xml");
    expect(xml).toContain("<a:hlinkClick r:id=\"rIdLink");
    expect(xml).toContain("</p:cNvPr>");
  });

  it("registers an external hyperlink relationship with the target URL", () => {
    const rels = part(hlinkDeck("https://particle.academy/fancy"), "ppt/slides/_rels/slide1.xml.rels");
    expect(rels).toContain(
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"',
    );
    expect(rels).toContain('Target="https://particle.academy/fancy"');
    expect(rels).toContain('TargetMode="External"');
  });

  it("emits no hlinkClick for elements without href", () => {
    const deck = {
      id: "hl2",
      title: "t",
      theme: { name: "default" },
      slides: [
        {
          id: "s1",
          layout: "blank",
          elements: [{ id: "x", type: "text", x: 0.1, y: 0.1, w: 0.5, h: 0.1, content: "plain", format: "plain" }],
        },
      ],
    };
    expect(part(deck, "ppt/slides/slide1.xml")).not.toContain("<a:hlinkClick");
  });
});
