import { describe, it, expect } from "vitest";
import { Agent } from "../src";

// Round-trip: toBytes → read should recover the major element kinds and their
// geometry / content for DarkSlide-emitted decks.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

function readBack(deck: Any): Any {
  return Agent.read(Agent.toBytes(deck));
}

describe("round-trip (toBytes → read)", () => {
  it("recovers text content + markdown decoration", () => {
    const deck = {
      id: "d",
      title: "RT Text",
      theme: { name: "default" },
      slides: [
        {
          id: "s1",
          layout: "blank",
          elements: [
            {
              id: "t1",
              type: "text",
              x: 0.1,
              y: 0.2,
              w: 0.5,
              h: 0.2,
              content: "Plain then **bold** word",
              format: "markdown",
            },
          ],
        },
      ],
    };
    const out = readBack(deck);
    const el = out.slides[0].elements[0];
    expect(el.type).toBe("text");
    expect(el.content).toBe("Plain then **bold** word");
    expect(el.format).toBe("markdown");
    expect(el.x).toBeCloseTo(0.1, 4);
    expect(el.w).toBeCloseTo(0.5, 4);
  });

  it("recovers a shape with its preset geometry", () => {
    const deck = {
      id: "d",
      title: "RT Shape",
      theme: { name: "default" },
      slides: [
        {
          id: "s1",
          layout: "blank",
          elements: [
            { id: "shp", type: "shape", x: 0.2, y: 0.2, w: 0.3, h: 0.3, shape: "ellipse", fill: "#FF0000" },
          ],
        },
      ],
    };
    const out = readBack(deck);
    const el = out.slides[0].elements[0];
    expect(el.type).toBe("shape");
    expect(el.shape).toBe("ellipse");
  });

  it("recovers a table's columns and rows", () => {
    const deck = {
      id: "d",
      title: "RT Table",
      theme: { name: "default" },
      slides: [
        {
          id: "s1",
          layout: "blank",
          elements: [
            {
              id: "tbl",
              type: "table",
              x: 0.1,
              y: 0.1,
              w: 0.8,
              h: 0.4,
              columns: [
                { key: "a", label: "Alpha" },
                { key: "b", label: "Beta" },
              ],
              rows: [
                { a: "1", b: "2" },
                { a: "3", b: "4" },
              ],
            },
          ],
        },
      ],
    };
    const out = readBack(deck);
    const el = out.slides[0].elements.find((e: Any) => e.type === "table");
    expect(el).toBeTruthy();
    expect(el.columns.map((c: Any) => c.label)).toEqual(["Alpha", "Beta"]);
    expect(el.rows.length).toBe(2);
    expect(el.rows[0].col1).toBe("1");
    expect(el.rows[1].col2).toBe("4");
  });

  it("recovers a solid background color", () => {
    const deck = {
      id: "d",
      title: "RT Bg",
      theme: { name: "default" },
      slides: [{ id: "s1", layout: "blank", background: { color: "#123456" }, elements: [] }],
    };
    const out = readBack(deck);
    expect(out.slides[0].background.color).toBe("#123456");
  });

  it("recovers a gradient background (angle round-trips)", () => {
    const deck = {
      id: "d",
      title: "RT Grad",
      theme: { name: "default" },
      slides: [
        {
          id: "s1",
          layout: "blank",
          background: { gradient: "linear-gradient(90deg, #ff0000 0%, #00ff00 100%)" },
          elements: [],
        },
      ],
    };
    const out = readBack(deck);
    expect(out.slides[0].background.gradient).toMatch(/^linear-gradient\(90deg, #ff0000 0%, #00ff00 100%\)$/);
  });

  it("recovers an embedded image as a data URI", () => {
    const deck = {
      id: "d",
      title: "RT Img",
      theme: { name: "default" },
      slides: [
        {
          id: "s1",
          layout: "blank",
          elements: [{ id: "img", type: "image", x: 0.1, y: 0.1, w: 0.2, h: 0.2, src: PNG_1x1, fit: "contain" }],
        },
      ],
    };
    const out = readBack(deck);
    const el = out.slides[0].elements.find((e: Any) => e.type === "image");
    expect(el).toBeTruthy();
    expect(String(el.src)).toMatch(/^data:image\/png;base64,/);
  });

  it("recovers slide notes", () => {
    const deck = {
      id: "d",
      title: "RT Notes",
      theme: { name: "default" },
      slides: [
        {
          id: "s1",
          layout: "blank",
          notes: "first\nsecond",
          elements: [{ id: "t", type: "text", x: 0.1, y: 0.1, w: 0.3, h: 0.1, content: "hi", format: "plain" }],
        },
      ],
    };
    const out = readBack(deck);
    expect(out.slides[0].notes).toBe("first\nsecond");
  });
});
