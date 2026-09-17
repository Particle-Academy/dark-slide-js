import { describe, it, expect } from "vitest";
import { Agent, PptxReader, unzipSync, zipSync } from "../src";
import { crc32 } from "../src/zip";

/**
 * `read()` is a pure function of its bytes.
 *
 * Until 0.8.1 it was not, in two places: the deck id came from `Date.now()`,
 * and an element whose `<p:cNvPr>` carried no `name` got a `Math.random()`
 * number. The second is the worse one — the clock id only moved across a tick,
 * while a nameless shape got a new id on every single read.
 *
 * It matters because reads get DIFFED. A consumer storing file history as
 * reverse edits compares two read structures, so a field that moves on its own
 * turns a diff of identical content into a whole-deck `replace` — a save that
 * changed nothing storing the entire deck, which is precisely what that design
 * exists to avoid. Reported as dark-slide#9, against all three engines at once:
 * a parity suite only detects DISAGREEMENT, and the three ports had the same
 * bug, so it agreed with itself perfectly.
 *
 * Both halves are asserted without waiting for a clock tick, deliberately: a
 * test that reads twice and hopes to straddle a second boundary passes by luck.
 * Same bytes agree; different bytes disagree.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

const DECK: Any = {
  id: "pure",
  title: "Purity",
  theme: { name: "default" },
  slides: [
    {
      id: "s1",
      layout: "blank",
      elements: [
        { id: "t1", type: "text", x: 0.1, y: 0.1, w: 0.5, h: 0.2, content: "Hello" },
        { id: "r1", type: "shape", shape: "rect", x: 0.6, y: 0.1, w: 0.2, h: 0.2, fill: "#FF0000" },
        { id: "i1", type: "image", x: 0.1, y: 0.4, w: 0.2, h: 0.2, src: PNG_1x1, fit: "contain" },
        {
          id: "tb1",
          type: "table",
          x: 0.1,
          y: 0.7,
          w: 0.8,
          h: 0.2,
          columns: [{ key: "a", label: "A" }, { key: "b", label: "B" }],
          rows: [{ a: "1", b: "2" }],
        },
      ],
    },
    {
      id: "s2",
      layout: "blank",
      elements: [{ id: "t2", type: "text", x: 0.1, y: 0.1, w: 0.5, h: 0.2, content: "Second" }],
    },
  ],
};

const BYTES = Agent.toBytes(DECK);

/**
 * The same deck with every `name` attribute stripped off its slide parts.
 *
 * A deck DarkSlide wrote always names its shapes, so its own output never
 * reaches the fallback and a round-trip test cannot see this bug at all. Files
 * from other producers do reach it — a nameless `<p:cNvPr>` is what a consumer
 * importing arbitrary decks is handed.
 */
function namelessBytes(): Uint8Array {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const parts = unzipSync(BYTES);

  return zipSync(
    Object.entries(parts).map(([name, data]) => ({
      name,
      data: name.startsWith("ppt/slides/slide")
        ? encoder.encode(decoder.decode(data).replace(/(<p:cNvPr\b[^>]*?)\s+name="[^"]*"/g, "$1"))
        : data,
    })),
  );
}

const NAMELESS = namelessBytes();

function elementIds(deck: Any): string[] {
  return deck.slides.flatMap((slide: Any) => (slide.elements ?? []).map((element: Any) => element.id));
}

describe("read() is a pure function of its bytes", () => {
  it("returns an identical structure for identical bytes", () => {
    expect(Agent.read(BYTES)).toEqual(Agent.read(BYTES));
  });

  it("returns an identical structure for elements that have no name to borrow an id from", () => {
    const first = Agent.read(NAMELESS);
    const second = Agent.read(NAMELESS);

    // Named early, because a bare structure diff says nothing about WHICH
    // field moved.
    expect(elementIds(first)).not.toHaveLength(0);
    expect(elementIds(second)).toEqual(elementIds(first));
    expect(second).toEqual(first);
  });

  it("gives two different decks two different ids", () => {
    // The clock id's other half: `Date.now()` does not only move, it also
    // COLLIDES. Every deck imported in the same second shared one id, so a
    // store keyed on it overwrote one import with another.
    const other = Agent.toBytes({ ...DECK, title: "A different deck entirely" });

    expect((Agent.read(BYTES) as Any).id).not.toBe((Agent.read(other) as Any).id);
  });

  it("reuses one reader instance without carrying state between files", () => {
    const reader = new PptxReader();

    const fresh = new PptxReader().fromBytes(NAMELESS);
    reader.fromBytes(BYTES);

    expect(reader.fromBytes(NAMELESS)).toEqual(fresh);
  });

  it("derives the deck id from the bytes and nothing else", () => {
    expect((Agent.read(BYTES) as Any).id).toBe("imported-" + crc32(BYTES).toString(16).padStart(8, "0"));
  });
});
