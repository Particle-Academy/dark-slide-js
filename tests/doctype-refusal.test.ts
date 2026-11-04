import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Agent, unzipSync, zipSync } from "../src/index";
import { parseXml } from "../src/reader/xml";

/**
 * Every XML part of an uploaded deck is read through one gate, which refuses a
 * DOCTYPE. Mirrors PHP tests/Unit/DoctypeRefusalTest.php.
 *
 * Everything goes through the public reader. This port's parser has no entity
 * machinery, so nothing can expand here: what the suite holds is that it refuses
 * the same parts as the other two, and reads no content they would not.
 */
const MARKER = "HSBASE";
const ENTITY = "HSINT";
const DOCTYPE = `<!DOCTYPE r [<!ENTITY x "${ENTITY}">]>`;

const enc = new TextEncoder();
const dec = new TextDecoder();
type Parts = Record<string, Uint8Array>;

const pptxParts = (): Parts =>
  unzipSync(
    Agent.toBytes({
      id: "d",
      title: MARKER,
      theme: { name: "default" },
      slides: [
        {
          id: "s1",
          layout: "blank",
          notes: MARKER,
          elements: [{ id: "t1", type: "text", content: MARKER, x: 0.1, y: 0.1, w: 0.8, h: 0.1 }],
        },
      ],
    } as never),
  );

const zipOf = (parts: Parts): Uint8Array => zipSync(Object.entries(parts).map(([name, data]) => ({ name, data })));

function withDoctype(xml: string, doctype: string = DOCTYPE): string {
  const m = /^<\?xml[^>]*\?>\s*/.exec(xml);
  return m ? m[0] + doctype + xml.slice(m[0].length) : doctype + xml;
}

const declared = (xml: string, encoding: string): string =>
  xml.replace(/^<\?xml[^>]*\?>/, `<?xml version="1.0" encoding="${encoding}"?>`);

const utf16le = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "utf16le"));
const utf16be = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "utf16le").swap16());
const concat = (a: number[], b: Uint8Array): Uint8Array => new Uint8Array([...a, ...b]);

const ENCODINGS: Record<string, (x: string) => Uint8Array> = {
  "plain UTF-8": (x) => enc.encode(x),
  "UTF-8 with a BOM": (x) => concat([0xef, 0xbb, 0xbf], enc.encode(x)),
  "UTF-16LE with a BOM": (x) => concat([0xff, 0xfe], utf16le(declared(x, "UTF-16"))),
  "UTF-16BE with a BOM": (x) => concat([0xfe, 0xff], utf16be(declared(x, "UTF-16"))),
  "UTF-16LE without a BOM": (x) => utf16le(declared(x, "UTF-16")),
  "past a long comment": (x) => enc.encode(x.replace(/^(<\?xml[^>]*\?>\s*)/, `$1<!-- ${"p".repeat(5000)} -->`)),
};
const ENCODING_NAMES = Object.keys(ENCODINGS);

/** The parts this port reads whose marker reaches the result. */
const MARKER_PARTS = ["docProps/core.xml", "ppt/slides/slide1.xml", "ppt/notesSlides/notesSlide1.xml"];

const text = (parts: Parts, part: string): string => dec.decode(parts[part]!);
const referencing = (parts: Parts, part: string): string => text(parts, part).split(MARKER).join("&x;");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readDeck = (parts: Parts): any => Agent.read(zipOf(parts));

function readText(parts: Parts): string {
  try {
    // This line's reader derives the deck id from the clock, so two reads of one
    // file can differ by it alone.
    const { id: _id, ...deck } = readDeck(parts);
    return JSON.stringify(deck);
  } catch {
    return "(refused)";
  }
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

it("reads every marker from a clean deck, so a missing one means refused", () => {
  expect(count(readText(pptxParts()), MARKER)).toBe(3);
});

describe("a DOCTYPE on a part", () => {
  it.each(MARKER_PARTS.flatMap((p) => ENCODING_NAMES.map((e) => [p, e] as const)))("is refused in %s, %s", (part, encoding) => {
    const parts = pptxParts();
    parts[part] = ENCODINGS[encoding]!(withDoctype(referencing(parts, part)));
    const got = readText(parts);

    expect(got).not.toContain(ENTITY);
    expect(got).not.toContain("&x;");
  });

  it.each(MARKER_PARTS.flatMap((p) => ENCODING_NAMES.map((e) => [p, e] as const)))("still reads %s without one, %s", (part, encoding) => {
    const parts = pptxParts();
    const clean = readText(parts);
    parts[part] = ENCODINGS[encoding]!(text(parts, part));

    expect(readText(parts)).toBe(clean);
  });

  it.each([
    ["ppt/_rels/presentation.xml.rels", "slides/slide1.xml", '"t1"'],
    ["ppt/slides/_rels/slide1.xml.rels", "../notesSlides/notesSlide1.xml", '"notes"'],
  ])("does not follow %s", (part, target, probe) => {
    const parts = pptxParts();
    expect(text(parts, part)).toContain(target);
    parts[part] = enc.encode(withDoctype(text(parts, part)));

    expect(readText(parts)).not.toContain(probe);
  });
});

describe("what a consumer sees, per part: the same table as PHP", () => {
  it("falls back to the default title for a refused core part", () => {
    const parts = pptxParts();
    parts["docProps/core.xml"] = enc.encode(withDoctype(text(parts, "docProps/core.xml")));

    expect(readDeck(parts).title).toBe("Imported");
  });

  it("keeps the slide, with no elements, for a refused slide part", () => {
    const parts = pptxParts();
    parts["ppt/slides/slide1.xml"] = enc.encode(withDoctype(text(parts, "ppt/slides/slide1.xml")));
    const slide = readDeck(parts).slides[0];

    expect(slide.id).toBe("imported-slide-1");
    expect(slide.elements).toEqual([]);
  });

  it("reads no slides for refused presentation relationships", () => {
    const parts = pptxParts();
    parts["ppt/_rels/presentation.xml.rels"] = enc.encode(withDoctype(text(parts, "ppt/_rels/presentation.xml.rels")));

    expect(readDeck(parts).slides).toEqual([]);
  });

  it("reads the rest of the deck without a refused notes part", () => {
    const parts = pptxParts();
    parts["ppt/notesSlides/notesSlide1.xml"] = enc.encode(withDoctype(text(parts, "ppt/notesSlides/notesSlide1.xml")));
    const slide = readDeck(parts).slides[0];

    expect(slide).not.toHaveProperty("notes");
    expect(slide.elements).toHaveLength(1);
  });
});

describe("the subset is never read as content", () => {
  // An entity value may hold a '>', which is where a scan for the end of the
  // declaration would stop. What follows it must not become the part's root.
  const smuggling = (root: string): string => `<!DOCTYPE r [<!ENTITY y "a>${root}">]>`;

  it("takes no root from inside the subset", () => {
    expect(parseXml(`<?xml version="1.0"?>${smuggling("<evil/>")}<r/>`)).toBeNull();
  });

  it("takes no title from inside the subset", () => {
    const parts = pptxParts();
    const core =
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>HSSMUGGLED</dc:title></cp:coreProperties>';
    parts["docProps/core.xml"] = enc.encode(withDoctype(text(parts, "docProps/core.xml"), smuggling(core)));

    expect(readText(parts)).not.toContain("HSSMUGGLED");
  });
});

describe("external entities", () => {
  let dir: string;
  let url: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ds-dt-"));
    const canary = join(dir, "canary.txt");
    writeFileSync(canary, "HSCANARY");
    url = `file:///${canary.split(String.fromCharCode(92)).join("/")}`;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.each(MARKER_PARTS)("neither loads nor leaks a file entity, %s", (part) => {
    const parts = pptxParts();
    parts[part] = enc.encode(withDoctype(referencing(parts, part), `<!DOCTYPE r [<!ENTITY x SYSTEM "${url}">]>`));
    const got = readText(parts);

    expect(readFileSync(url.replace("file:///", ""), "utf8")).toBe("HSCANARY");
    expect(got).not.toContain("HSCANARY");
  });
});

describe("text that only looks like a DOCTYPE", () => {
  it("is kept in a slide written as CDATA", () => {
    const parts = pptxParts();
    parts["ppt/slides/slide1.xml"] = enc.encode(text(parts, "ppt/slides/slide1.xml").split(MARKER).join("<![CDATA[<!DOCTYPE html>]]>"));

    expect(readText(parts)).toContain("<!DOCTYPE html>");
  });

  it("does not stop a part being read from a comment", () => {
    const parts = pptxParts();
    parts["ppt/slides/slide1.xml"] = enc.encode(withDoctype(text(parts, "ppt/slides/slide1.xml"), "<!-- <!DOCTYPE x> -->"));

    expect(readText(parts)).toContain('"t1"');
  });
});

describe("the gate", () => {
  it("returns a tree for a clean part", () => {
    expect(parseXml('<?xml version="1.0"?><r a="1"><b>t</b></r>')?.attrs.a).toBe("1");
  });

  it("refuses a declaration of any kind, wherever it sits", () => {
    expect(parseXml(`${DOCTYPE}<r/>`)).toBeNull();
    expect(parseXml(`<r>${DOCTYPE}</r>`)).toBeNull();
    expect(parseXml("<!ELEMENT r ANY><r/>")).toBeNull();
  });

  it("finds a DOCTYPE past a comment that reads as ended once the encoding is ignored", () => {
    // U+2D2D is the bytes 2D 2D in UTF-16LE, so a part decoded as UTF-8 reads
    // "-->" here and the DOCTYPE after it sits outside the comment it is really in.
    const parts = pptxParts();
    const body = text(parts, "docProps/core.xml").replace(/^<\?xml[^>]*\?>\s*/, "");
    const tricky = (doctype: string): Uint8Array => concat([0xff, 0xfe], utf16le(`<!-- ⴭ> x -->${doctype}${body}`));

    // Without the DOCTYPE the same bytes read, so "Imported" below is the refusal.
    parts["docProps/core.xml"] = tricky("");
    expect(readDeck(parts).title).toBe(MARKER);

    parts["docProps/core.xml"] = tricky(DOCTYPE);
    expect(readDeck(parts).title).toBe("Imported");
  });

  it("leaves nothing in src/ decoding a part or scanning for a DOCTYPE outside the gate", () => {
    const root = join(import.meta.dirname, "..", "src");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (name.endsWith(".ts") && path !== join(root, "reader", "xml.ts")) {
          const source = readFileSync(path, "utf8");
          if (/<!DOCTYPE/i.test(source) || /DECODER\.decode/.test(source) || /UTF8\.decode/.test(source) || /new DOMParser/.test(source)) {
            offenders.push(name);
          }
        }
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
  });
});
