import { describe, it, expect } from "vitest";
import { Agent, PptxReader, unzipSync, zipSync } from "../src";

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
 *
 * **0.8.1's fix was half a fix, and every test in this file passed anyway.** It
 * derived the id from the whole package, and the package embeds a `gmdate()`
 * stamp in `docProps/core.xml` — so the clock read moved from the reader to the
 * WRITER. Two reads of one buffer still agreed, which is all these cases asked,
 * while a deck saved and re-read got a different id EVERY time instead of one
 * in five. That broke pptx version history in a consumer's shipped product.
 *
 * The lesson is in the shape of the cases below, not in the fix: every one of
 * them read the same buffer twice. A defect one serialisation away was outside
 * what any of them could see. "keeps the deck id when a save changed nothing"
 * is the case that reaches it.
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

/** Resolve once the wall-clock second has advanced, so two writes cannot share a timestamp. */
async function nextSecond(): Promise<void> {
  const second = Math.floor(Date.now() / 1000);
  while (Math.floor(Date.now() / 1000) === second) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The same package with ONLY `docProps/core.xml` replaced — a second save of one deck. */
function restamped(bytes: Uint8Array, modified: string): Uint8Array {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const parts = unzipSync(bytes);

  return zipSync(
    Object.entries(parts).map(([name, data]) => ({
      name,
      data:
        name === "docProps/core.xml"
          ? encoder.encode(
              decoder
                .decode(data)
                .replace(
                  /<dcterms:modified[^>]*>[^<]*<\/dcterms:modified>/,
                  `<dcterms:modified xsi:type="dcterms:W3CDTF">${modified}</dcterms:modified>`,
                ),
            )
          : data,
    })),
  );
}

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
    const changed = JSON.parse(JSON.stringify(DECK)) as Any;
    changed.slides[0].elements[0].content = "A different deck entirely";
    const other = Agent.toBytes(changed);

    expect((Agent.read(BYTES) as Any).id).not.toBe((Agent.read(other) as Any).id);
  });

  it("gives a renamed deck the SAME id, because the title lives in the excluded part", () => {
    // A consequence of excluding `docProps/core.xml` whole, recorded here so it
    // is a decision rather than something the next person discovers.
    // `<dc:title>` shares that part with the save timestamp, so a rename does
    // not move the id — the returned `title` still changes, so a differ still
    // sees the rename, and treating a renamed deck as the same deck is
    // defensible on its own terms. Narrowing the exclusion to the two
    // `<dcterms:*>` elements would change this, at the cost of regexing XML
    // inside the digest path in three engines; measured as unnecessary and
    // deliberately not done.
    const renamed = Agent.read(Agent.toBytes({ ...DECK, title: "Renamed, same deck" })) as Any;
    const original = Agent.read(BYTES) as Any;

    expect(renamed.title).not.toBe(original.title);
    expect(renamed.id).toBe(original.id);
  });

  it("reuses one reader instance without carrying state between files", () => {
    const reader = new PptxReader();

    const fresh = new PptxReader().fromBytes(NAMELESS);
    reader.fromBytes(BYTES);

    expect(reader.fromBytes(NAMELESS)).toEqual(fresh);
  });

  it("derives the deck id from the deck, not from when it was saved", () => {
    // The deterministic form of the case below, and the one that says WHY:
    // `docProps/core.xml` is the only entry a second save of one deck changes,
    // so the id must not depend on it. Measured, not assumed — of this
    // package's 43 entries, it is the only one that differs across a save.
    const stamped = restamped(BYTES, "2019-01-01T00:00:00Z");

    expect(stamped).not.toEqual(BYTES);
    expect((Agent.read(stamped) as Any).id).toBe((Agent.read(BYTES) as Any).id);
  });

  it("keeps the deck id when a save changed nothing", async () => {
    // The consumer-shaped case, and the one 0.8.1 would have failed: every
    // other test here reads ONE buffer twice, so a defect that needs a second
    // serialisation to appear is invisible to all of them.
    //
    // It starts from the SETTLED read form rather than from the authored deck,
    // because the reader is lossy by design — a composite comes back as the
    // table it became — so the first read-write-read genuinely changes the deck
    // and is supposed to change the id with it. What must hold is that it then
    // stops: from that point a save that changed nothing changes nothing.
    const settled = Agent.read(Agent.toBytes(Agent.read(BYTES))) as Any;

    // Forced, not hoped for. Two writes inside one second share a timestamp and
    // would pass against the very code this case exists to fail.
    await nextSecond();

    const afterAnotherSave = Agent.read(Agent.toBytes(settled)) as Any;

    expect(afterAnotherSave.id).toBe(settled.id);
    expect(afterAnotherSave).toEqual(settled);
  });
});
