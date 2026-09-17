import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
 * **It took three releases to state the property at the right level**, and the
 * first two both passed a suite that looked thorough:
 *
 *   0.8.1  id = digest(whole package)          followed the WRITER's clock
 *   0.8.2  id = digest(package minus core.xml) removed the clock, kept bytes
 *   0.8.3  id = digest(the deck read() returns)
 *
 * The middle one is the instructive failure. Excluding the clock-bearing part
 * removed one source of byte variance and left the others: a deck carrying a
 * shape or a code block re-serialises to different `ppt/slides/slideN.xml`
 * bytes, so the id still moved while the structure sat perfectly still. A digest
 * of bytes identifies a SERIALISATION; two serialisations of one deck are not
 * byte-equal, and no exclusion list was ever going to make them so.
 *
 * So the property is now: **any two byte layouts that read to the same structure
 * get the same id.** Note what that does NOT say — that a file from another
 * producer and one of ours "of the same deck" agree. That holds only as far as
 * `read()` normalises them to the same structure, which is not promised.
 * `foreign-libreoffice.pptx` shows both halves.
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

const FIXTURES = join(__dirname, "fixtures");

/**
 * A `.pptx` written by a genuinely independent producer.
 *
 * Regenerate with LibreOffice — reproducible, and the reason a binary is
 * committed rather than a generator nobody can run:
 *
 *   soffice --headless --convert-to pptx --outdir <dir> <ours.pptx>
 *
 * where `<ours.pptx>` is `Agent.toBytes(foreign-libreoffice-source.json)`. It is
 * LibreOffice, not PowerPoint; what matters is that the serialisation is not
 * ours, and its `<p:cNvPr>` / part layout / ordering are all its own.
 */
const FOREIGN = new Uint8Array(readFileSync(join(FIXTURES, "foreign-libreoffice.pptx")));

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

  it("gives a renamed deck a different id, because a title is content", () => {
    // 0.8.2 did the opposite, as a side effect of excluding `docProps/core.xml`
    // whole — `<dc:title>` lives in that part. Digesting the deck rather than the
    // package puts the title back where it belongs: `read()` returns it, so it
    // counts.
    const renamed = Agent.read(Agent.toBytes({ ...DECK, title: "Renamed, and that is a change" })) as Any;
    const original = Agent.read(BYTES) as Any;

    expect(renamed.title).not.toBe(original.title);
    expect(renamed.id).not.toBe(original.id);
  });

  it("gives two byte layouts of one structure the SAME id", () => {
    // THE property. Everything else in this file is a corollary of it.
    //
    // A shape element is the cheap way to induce it: our own writer does not
    // re-serialise a read-back shape to the same `ppt/slides/slide1.xml` bytes,
    // so these two packages genuinely differ on disk while reading to one deck.
    // The byte-difference is asserted first, because a test where the two
    // buffers happened to be identical would pass while proving nothing.
    const deck = {
      id: "two-layouts",
      title: "Two Layouts",
      theme: { name: "default" },
      slides: [
        {
          id: "s1",
          layout: "blank",
          elements: [
            { id: "r1", type: "shape", shape: "rect", x: 0.1, y: 0.1, w: 0.3, h: 0.3, fill: "#FF0000" },
          ],
        },
      ],
    };

    const layoutA = Agent.toBytes(deck);
    const readA = Agent.read(layoutA) as Any;
    const layoutB = Agent.toBytes(readA);
    const readB = Agent.read(layoutB) as Any;

    const withoutId = (d: Any): Any => {
      const copy = { ...d };
      delete copy.id;
      return copy;
    };

    expect(layoutB).not.toEqual(layoutA);
    expect(withoutId(readB)).toEqual(withoutId(readA));
    expect(readB.id).toBe(readA.id);
  });

  it("reads a foreign producer and our re-serialisation of it to one id", () => {
    // The consumer's production shape: version 1 of a deck is the file a user
    // uploaded, every version after it is ours. So the first edit of every
    // upload diffs a FOREIGN serialisation against one of ours.
    //
    // Neither this repo nor its two siblings had a single `.pptx` fixture before
    // this one — every fixture was generated by our own writer at test time,
    // which is the same blind spot that left the reader's RNG path unexercised
    // for several minor versions. See the note on the fixture below.
    const first = Agent.read(FOREIGN) as Any;
    const ours = Agent.toBytes(first);
    const second = Agent.read(ours) as Any;

    expect(first.slides.length).toBeGreaterThan(0);
    expect(ours).not.toEqual(FOREIGN);
    expect(second.id).toBe(first.id);
  });

  it("does NOT claim a foreign file and ours of one source deck share an id", () => {
    // The limit of the property, asserted so nobody widens the claim by
    // accident. `read()` recovers what it can model; LibreOffice's rendering of
    // this deck and ours do not reduce to the same structure, so the two ids
    // differ — correctly. The guarantee is about byte layouts of one STRUCTURE,
    // not about two producers' idea of one deck.
    const source = JSON.parse(readFileSync(join(FIXTURES, "foreign-libreoffice-source.json"), "utf8"));

    expect((Agent.read(FOREIGN) as Any).id).not.toBe((Agent.read(Agent.toBytes(source)) as Any).id);
  });

  it("uses only ASCII keys, which is what lets three engines sort them alike", () => {
    // The canonical encoding sorts map keys, and the three engines' sorts agree
    // only below U+10000 (JS sorts UTF-16 code units, PHP bytes, Python code
    // points). Every key a read deck contains is machine-generated, so this is
    // true by construction — checked rather than assumed, because the digest
    // silently depends on it.
    const keys = new Set<string>();
    const walk = (value: Any): void => {
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      if (value !== null && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
          keys.add(key);
          walk(item);
        }
      }
    };
    walk(Agent.read(BYTES));
    walk(Agent.read(FOREIGN));

    expect(keys.size).toBeGreaterThan(0);
    // eslint-disable-next-line no-control-regex
    expect([...keys].filter((k) => /[^\x20-\x7E]/.test(k))).toEqual([]);
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
