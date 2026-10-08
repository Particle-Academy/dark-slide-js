import { describe, expect, it } from "vitest";
import { unzipSync } from "../src";
import { PptxWriter } from "../src/writer/pptx-writer";

/**
 * `docProps/core.xml`'s timestamps are an INPUT when the deck supplies them.
 *
 * dark-slide#10. `buildCoreProps` embedded `new Date()` unconditionally, so two
 * `toBytes()` calls on one deck a second apart produced different bytes. That
 * makes the writer unusable for anything that compares or addresses its output:
 * a save that changed nothing reads as a change to a content-addressed store or
 * a byte-level diff.
 *
 * `dcterms:created` / `dcterms:modified` are legitimately timestamps -- Word and
 * PowerPoint display them -- so the clock is not removed. It becomes the
 * DEFAULT, and `metadata.created` / `metadata.modified` override it. A caller
 * wanting reproducible bytes supplies them; a caller that does not sees exactly
 * the previous behaviour.
 *
 * **The spelling was not chosen here.** `dark-slide-py` has honoured these two
 * keys since its first release, including `modified` falling back to `created`
 * rather than to the default. A consumer writes ONE deck for three engines, so a
 * second spelling would be the defect this fixes, one layer out.
 */
type Any = Record<string, unknown>;

function coreXmlOf(deck: Any): string {
  const files = unzipSync(new PptxWriter().toBytes(deck as never));
  return new TextDecoder().decode(files["docProps/core.xml"]!);
}

function deckWithMetadata(metadata: Any = {}): Any {
  return {
    id: "d1",
    title: "Timestamps",
    slides: [{ id: "s1", elements: [] }],
    metadata,
  };
}

const W3CDTF = /<dcterms:created xsi:type="dcterms:W3CDTF">\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z<\/dcterms:created>/;

describe("core.xml timestamps", () => {
  it("honours metadata.created and metadata.modified", () => {
    const xml = coreXmlOf(deckWithMetadata({ created: "2020-02-02T03:04:05Z", modified: "2021-03-03T04:05:06Z" }));

    expect(xml).toContain('<dcterms:created xsi:type="dcterms:W3CDTF">2020-02-02T03:04:05Z</dcterms:created>');
    expect(xml).toContain('<dcterms:modified xsi:type="dcterms:W3CDTF">2021-03-03T04:05:06Z</dcterms:modified>');
  });

  it("falls back modified to created, not to the clock", () => {
    // Python's rule, matched exactly. A deck that states when it was made and
    // says nothing about edits is not a deck modified "now".
    const xml = coreXmlOf(deckWithMetadata({ created: "2020-02-02T03:04:05Z" }));

    expect(xml).toContain('<dcterms:modified xsi:type="dcterms:W3CDTF">2020-02-02T03:04:05Z</dcterms:modified>');
  });

  it("is byte-stable across calls when the deck supplies its timestamps", () => {
    // The property the issue is about. Asserted with an explicit timestamp
    // rather than two fast calls -- a test that passes only when both calls land
    // inside the same second goes red on the rare run that straddles a tick,
    // which reads as flakiness and gets retried rather than investigated.
    const deck = deckWithMetadata({ created: "2020-02-02T03:04:05Z", modified: "2020-02-02T03:04:05Z" });
    const writer = new PptxWriter();

    expect(writer.toBytes(deck as never)).toEqual(writer.toBytes(deck as never));
  });

  it("still writes a clock timestamp when the deck supplies none", () => {
    // Unchanged for every existing caller, which is what makes this additive.
    // Matched on shape: asserting a value would be asserting the clock.
    const xml = coreXmlOf(deckWithMetadata());

    expect(xml).toMatch(W3CDTF);
    expect(xml).not.toContain("1980-01-01T00:00:00Z");
  });

  it("escapes a supplied timestamp instead of pasting it into the XML", () => {
    // It is consumer input now, which it was not when it came from `new Date()`.
    // An unescaped value would let a deck close the element early and rewrite
    // the rest of the part.
    const xml = coreXmlOf(deckWithMetadata({ created: "</dcterms:created><evil>&" }));

    expect(xml).not.toContain("<evil>");
    expect(xml).toContain("&lt;/dcterms:created&gt;&lt;evil&gt;&amp;");
  });

  it("ignores a non-string or empty timestamp rather than writing it", () => {
    for (const metadata of [{ created: "" }, { created: 12345 }, { created: ["x"] }, { created: null }]) {
      expect(coreXmlOf(deckWithMetadata(metadata as Any))).toMatch(W3CDTF);
    }
  });
});
