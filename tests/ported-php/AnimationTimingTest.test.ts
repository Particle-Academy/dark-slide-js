import { describe, it, expect } from "vitest";
import { Agent, unzipSync } from "../../src";

// Ported from PHP tests/Unit/AnimationTimingTest.php.
//
// The PHP suite uses DOMDocument::loadXML to assert well-formedness. We have no
// XML-dependency to add, so the well-formedness guard is replaced by a
// lightweight balanced-tag check (isWellFormed). All the *substantive*
// assertions — timing tree shape, spTgt↔cNvPr id matching, click-step counts,
// paragraph ranges, entrance pre-hide — are ported verbatim against the same
// emitted slide XML, which is what actually pins the spec.

const dec = new TextDecoder();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function animFixture(): Any {
  return {
    id: "anim",
    title: "animation deck",
    theme: { name: "default", colors: { accent: "#8B5CF6" } },
    slides: [{ id: "s1", layout: "title", elements: [] }],
  };
}

function slideXml(deck: Any, part: string): string {
  const files = unzipSync(Agent.toBytes(deck));
  const f = files[part];
  return f ? dec.decode(f) : "";
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

/** Lightweight well-formedness: every non-self-closing/non-void tag is balanced. */
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

function spTgtSpids(xml: string): number[] {
  return [...xml.matchAll(/<p:spTgt spid="(\d+)"\/>/g)].map((m) => parseInt(m[1]!, 10));
}
function cNvPrIds(xml: string): number[] {
  return [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => parseInt(m[1]!, 10));
}
function pRanges(xml: string): [number, number][] {
  return [...xml.matchAll(/<p:pRg st="(\d+)" end="(\d+)"\/>/g)].map((m) => [parseInt(m[1]!, 10), parseInt(m[2]!, 10)]);
}

describe("animation timing (ported PHP AnimationTimingTest)", () => {
  it("emits no timing node when no element is animated", () => {
    const deck = animFixture();
    deck.slides[0].elements.push({
      id: "plain",
      type: "text",
      x: 0.1,
      y: 0.1,
      w: 0.8,
      h: 0.2,
      content: "Hello",
      format: "plain",
    });
    expect(slideXml(deck, "ppt/slides/slide1.xml")).not.toContain("<p:timing>");
  });

  it("emits a well-formed timing tree for three animated text elements", () => {
    const deck = animFixture();
    deck.slides[0].elements = [
      {
        id: "a",
        type: "text",
        x: 0.1,
        y: 0.1,
        w: 0.8,
        h: 0.2,
        content: "One",
        format: "plain",
        animation: { effect: "fade", trigger: "on-click" },
      },
      {
        id: "b",
        type: "text",
        x: 0.1,
        y: 0.4,
        w: 0.8,
        h: 0.2,
        content: "Two",
        format: "plain",
        animation: { effect: "fly-in", trigger: "with-prev", direction: "left" },
      },
      {
        id: "c",
        type: "text",
        x: 0.1,
        y: 0.7,
        w: 0.8,
        h: 0.2,
        content: "Three",
        format: "plain",
        animation: { effect: "zoom", trigger: "after-prev" },
      },
    ];
    const xml = slideXml(deck, "ppt/slides/slide1.xml");

    expect(isWellFormed(xml)).toBe(true);

    expect(xml).toContain("<p:timing>");
    expect(xml.indexOf("<p:timing>")).toBeGreaterThan(xml.indexOf("</p:cSld>"));

    expect(xml).toContain('nodeType="mainSeq"');
    expect(xml).toContain('nodeType="tmRoot"');

    expect(count(xml, '<p:cond delay="indefinite"/>')).toBe(1);

    expect(xml).toContain('filter="fade"');
    expect(xml).toContain("ppt_x");
    expect(xml).toContain("<p:animScale>");
    expect(xml).toContain('<p:from x="0" y="0"/>');

    expect(xml).toContain('presetClass="entr"');
    expect(xml).toContain('<p:strVal val="visible"/>');
  });

  it("produces the right number of click steps for mixed triggers", () => {
    const deck = animFixture();
    deck.slides[0].elements = [
      {
        id: "a",
        type: "text",
        x: 0.1,
        y: 0.1,
        w: 0.8,
        h: 0.2,
        content: "One",
        format: "plain",
        animation: { effect: "fade", trigger: "on-click" },
      },
      {
        id: "b",
        type: "text",
        x: 0.1,
        y: 0.4,
        w: 0.8,
        h: 0.2,
        content: "Two",
        format: "plain",
        animation: { effect: "wipe", trigger: "on-click", direction: "up" },
      },
      {
        id: "c",
        type: "text",
        x: 0.1,
        y: 0.7,
        w: 0.8,
        h: 0.2,
        content: "Three",
        format: "plain",
        animation: { effect: "fade", trigger: "with-prev" },
      },
    ];
    const xml = slideXml(deck, "ppt/slides/slide1.xml");
    expect(count(xml, '<p:cond delay="indefinite"/>')).toBe(2);
    expect(xml).toContain('filter="wipe(down)"');
  });

  it("matches every spTgt spid to a real cNvPr shape id", () => {
    const deck = animFixture();
    deck.slides[0].elements = [
      { id: "plain", type: "text", x: 0.1, y: 0.1, w: 0.8, h: 0.1, content: "Title", format: "plain" },
      {
        id: "a",
        type: "text",
        x: 0.1,
        y: 0.3,
        w: 0.8,
        h: 0.2,
        content: "One",
        format: "plain",
        animation: { effect: "fade" },
      },
      {
        id: "b",
        type: "shape",
        shape: "rect",
        x: 0.1,
        y: 0.6,
        w: 0.3,
        h: 0.2,
        animation: { effect: "fly-in", trigger: "after-prev", direction: "right" },
      },
    ];
    const xml = slideXml(deck, "ppt/slides/slide1.xml");
    const shapeIds = cNvPrIds(xml);
    const targets = spTgtSpids(xml);

    expect(targets).not.toHaveLength(0);
    for (const spid of [...new Set(targets)]) {
      expect(shapeIds).toContain(spid);
    }
    expect(targets).toContain(3);
    expect(targets).toContain(4);
    expect(targets).not.toContain(2);
  });

  it("orders builds by order then array index", () => {
    const deck = animFixture();
    deck.slides[0].elements = [
      {
        id: "a",
        type: "text",
        x: 0.1,
        y: 0.1,
        w: 0.8,
        h: 0.2,
        content: "A",
        format: "plain",
        animation: { effect: "fade", order: 5 },
      },
      {
        id: "b",
        type: "text",
        x: 0.1,
        y: 0.4,
        w: 0.8,
        h: 0.2,
        content: "B",
        format: "plain",
        animation: { effect: "fade", order: 0 },
      },
    ];
    const xml = slideXml(deck, "ppt/slides/slide1.xml");
    const seqPos = xml.indexOf('nodeType="mainSeq"');
    const afterSeq = xml.slice(seqPos);
    const seqTargets = spTgtSpids(afterSeq);
    expect(seqTargets[0]).toBe(3);
  });

  it("splits a byParagraph text element into one paragraph-scoped build node per line", () => {
    const deck = animFixture();
    deck.slides[0].elements = [
      {
        id: "lines",
        type: "text",
        x: 0.1,
        y: 0.1,
        w: 0.8,
        h: 0.5,
        content: "Line one\nLine two\nLine three",
        format: "plain",
        animation: { effect: "fade", byParagraph: true, trigger: "on-click" },
      },
    ];
    const xml = slideXml(deck, "ppt/slides/slide1.xml");

    expect(isWellFormed(xml)).toBe(true);

    const seqXml = xml.slice(xml.indexOf('nodeType="mainSeq"'));

    expect(seqXml).toContain('<p:pRg st="0" end="0"/>');
    expect(seqXml).toContain('<p:pRg st="1" end="1"/>');
    expect(seqXml).toContain('<p:pRg st="2" end="2"/>');

    for (const spid of [...new Set(spTgtSpids(seqXml))]) {
      expect(spid).toBe(2);
    }

    // No whole-shape (pRg-less) build target: every spTgt in the build region is
    // NOT self-closing (it wraps a txEl/pRg). PHP matched the spTgt closing char.
    for (const m of seqXml.matchAll(/<p:spTgt spid="\d+"(\/?>)/g)) {
      expect(m[1]).not.toBe("/>");
    }

    expect(count(seqXml, '<p:cond delay="indefinite"/>')).toBe(3);

    const ranges = pRanges(seqXml);
    const distinct: [number, number][] = [];
    for (const r of ranges) {
      const last = distinct[distinct.length - 1];
      if (!last || last[0] !== r[0] || last[1] !== r[1]) distinct.push(r);
    }
    expect(distinct).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);

    expect(count(seqXml, 'presetClass="entr"')).toBe(3);
    expect(seqXml).toContain('<p:strVal val="visible"/>');
    expect(xml).not.toContain('<p:strVal val="hidden"/>');
  });

  it("keeps a 3-line element WITHOUT byParagraph as a single whole-shape build", () => {
    const deck = animFixture();
    deck.slides[0].elements = [
      {
        id: "block",
        type: "text",
        x: 0.1,
        y: 0.1,
        w: 0.8,
        h: 0.5,
        content: "Line one\nLine two\nLine three",
        format: "plain",
        animation: { effect: "fade", trigger: "on-click" },
      },
    ];
    const xml = slideXml(deck, "ppt/slides/slide1.xml");

    expect(isWellFormed(xml)).toBe(true);
    expect(xml).not.toContain("<p:pRg");
    expect(xml).toContain('<p:spTgt spid="2"/>');
    expect(count(xml, '<p:cond delay="indefinite"/>')).toBe(1);
  });

  it("ignores byParagraph on non-text elements (whole-shape target)", () => {
    const deck = animFixture();
    deck.slides[0].elements = [
      {
        id: "box",
        type: "shape",
        shape: "rect",
        x: 0.1,
        y: 0.1,
        w: 0.3,
        h: 0.2,
        animation: { effect: "fade", byParagraph: true, trigger: "on-click" },
      },
    ];
    const xml = slideXml(deck, "ppt/slides/slide1.xml");
    expect(xml).not.toContain("<p:pRg");
    expect(xml).toContain('<p:spTgt spid="2"/>');
  });
});
