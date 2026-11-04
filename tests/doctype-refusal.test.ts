import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Agent, ArchiveRefused, OfficeTemplateRefused, unzipSync, zipSync } from "../src/index";
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
const MAIN = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
const MACRO_TEMPLATE = "application/vnd.ms-powerpoint.template.macroEnabled.main+xml";

const enc = new TextEncoder();
const dec = new TextDecoder();
type Parts = Record<string, Uint8Array>;

const pptxParts = (): Parts =>
  unzipSync(
    Agent.toBytes({
      id: "d",
      title: MARKER,
      theme: { name: "default", fonts: { heading: MARKER } },
      slides: [
        {
          id: "s1",
          layout: "blank",
          notes: MARKER,
          elements: [
            { id: "t1", type: "text", content: MARKER, x: 0.1, y: 0.1, w: 0.8, h: 0.1 },
            {
              id: "c1",
              type: "chart",
              x: 0.1,
              y: 0.3,
              w: 0.5,
              h: 0.5,
              option: {
                title: { text: MARKER },
                xAxis: { type: "category", data: ["a"] },
                yAxis: { type: "value" },
                series: [{ type: "bar", name: "n", data: [1] }],
              },
            },
          ],
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

const MARKER_PARTS = ["docProps/core.xml", "ppt/theme/theme1.xml", "ppt/slides/slide1.xml", "ppt/notesSlides/notesSlide1.xml", "ppt/charts/chart1.xml"];

const text = (parts: Parts, part: string): string => dec.decode(parts[part]!);
const referencing = (parts: Parts, part: string): string => text(parts, part).split(MARKER).join("&x;");
const read = (parts: Parts): any => Agent.read(zipOf(parts));

function readText(parts: Parts): string {
  try {
    return JSON.stringify(read(parts));
  } catch {
    return "(refused)";
  }
}

function fourByThree(parts: Parts): Parts {
  const out = { ...parts };
  const xml = text(parts, "ppt/presentation.xml");
  const changed = xml.replace(/(<p:sldSz\b[^>]*\bcy=")\d+/, "$19144000");
  expect(changed).not.toBe(xml);
  out["ppt/presentation.xml"] = enc.encode(changed);
  return out;
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

it("reads every marker from a clean deck, so a missing one means refused", () => {
  expect(count(readText(pptxParts()), MARKER)).toBe(5);
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
    ["ppt/slides/_rels/slide1.xml.rels", "../charts/chart1.xml", '"c1"'],
  ])("does not follow %s to %s", (part, target, probe) => {
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

    expect(read(parts).title).toBe("Imported");
  });

  it("keeps the slide, with no elements, for a refused slide part", () => {
    const parts = pptxParts();
    parts["ppt/slides/slide1.xml"] = enc.encode(withDoctype(text(parts, "ppt/slides/slide1.xml")));
    const slide = read(parts).slides[0];

    expect(slide.id).toBe("imported-slide-1");
    expect(slide.elements).toEqual([]);
  });

  it("reads no slides for refused presentation relationships", () => {
    const parts = pptxParts();
    parts["ppt/_rels/presentation.xml.rels"] = enc.encode(withDoctype(text(parts, "ppt/_rels/presentation.xml.rels")));

    expect(read(parts).slides).toEqual([]);
  });

  it("reads the rest of the deck without a refused notes part", () => {
    const parts = pptxParts();
    parts["ppt/notesSlides/notesSlide1.xml"] = enc.encode(withDoctype(text(parts, "ppt/notesSlides/notesSlide1.xml")));
    const slide = read(parts).slides[0];

    expect(slide).not.toHaveProperty("notes");
    expect(slide.elements).toHaveLength(2);
  });

  it("drops a chart whose part is refused and keeps the other elements", () => {
    const parts = pptxParts();
    parts["ppt/charts/chart1.xml"] = enc.encode(withDoctype(text(parts, "ppt/charts/chart1.xml")));
    const elements = read(parts).slides[0].elements as { id: string; type: string }[];

    expect(elements.map((e) => e.type)).not.toContain("chart");
    expect(elements.map((e) => e.id)).toContain("t1");
  });

  it("reads a slide size from a clean presentation part, so its absence below is the refusal", () => {
    expect(read(fourByThree(pptxParts())).theme).toHaveProperty("aspectRatio");
  });

  it("takes nothing from a refused presentation part", () => {
    const parts = fourByThree(pptxParts());
    parts["ppt/presentation.xml"] = enc.encode(withDoctype(text(parts, "ppt/presentation.xml")));

    expect(read(parts).theme).not.toHaveProperty("aspectRatio");
  });

  it("takes no mono font from a refused theme", () => {
    const parts = unzipSync(
      Agent.toBytes({
        id: "d",
        title: "t",
        theme: { name: "default", fonts: { mono: "HSFACE" } },
        slides: [{ id: "s1", layout: "blank", elements: [{ id: "k1", type: "code", language: "text", code: "x", x: 0.1, y: 0.1, w: 0.8, h: 0.3 }] }],
      } as never),
    );
    const clean = read(parts);
    const bare = { ...parts };
    delete bare["ppt/theme/theme1.xml"];
    const absent = read(bare);
    parts["ppt/theme/theme1.xml"] = enc.encode(withDoctype(text(parts, "ppt/theme/theme1.xml")));

    // A run in the recorded mono face reads as code, so the face changes the slide.
    expect(clean.slides).not.toEqual(absent.slides);
    expect(read(parts).slides).toEqual(absent.slides);
  });
});

describe("the subset is never read as content", () => {
  // An entity value may hold a '>', which is where a scan for the end of the
  // declaration would stop. What follows it must not become the part's root.
  const smuggling = (root: string): string => `<!DOCTYPE r [<!ENTITY y "a>${root}">]>`;

  it("takes no root from inside the subset", () => {
    expect(parseXml(`<?xml version="1.0"?>${smuggling("<evil/>")}<r/>`)).toBeNull();
  });

  it("takes no slide content from inside the subset", () => {
    const parts = pptxParts();
    const real = text(parts, "ppt/slides/slide1.xml");
    const slide = real.replace(/^<\?xml[^>]*\?>\s*/, "").split(MARKER).join("HSSMUGGLED");
    expect(slide).not.toContain("'");
    parts["ppt/slides/slide1.xml"] = enc.encode(withDoctype(real, `<!DOCTYPE r [<!ENTITY y 'a>${slide}'>]>`));

    expect(readText(parts)).not.toContain("HSSMUGGLED");
  });
});

describe("the package declaration", () => {
  const macroTemplate = (): Parts => {
    const parts = pptxParts();
    expect(text(parts, "[Content_Types].xml")).toContain(MAIN);
    parts["[Content_Types].xml"] = enc.encode(text(parts, "[Content_Types].xml").replace(MAIN, MACRO_TEMPLATE));
    return parts;
  };

  function expectRefused(parts: Parts): void {
    let caught: unknown;
    try {
      read(parts);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ArchiveRefused);
    expect((caught as ArchiveRefused).reason).toBe("archive_unsupported");
  }

  it("refuses a macro template for its declaration, so the cases below have something to skip", () => {
    expect(() => read(macroTemplate())).toThrow(OfficeTemplateRefused);
  });

  it.each(ENCODING_NAMES)("reads a clean declaration, %s", (encoding) => {
    const parts = pptxParts();
    const clean = readText(parts);
    parts["[Content_Types].xml"] = ENCODINGS[encoding]!(text(parts, "[Content_Types].xml"));

    expect(readText(parts)).toBe(clean);
  });

  it.each(ENCODING_NAMES)("refuses the macro template when its declaration carries a DOCTYPE, %s", (encoding) => {
    const parts = macroTemplate();
    parts["[Content_Types].xml"] = ENCODINGS[encoding]!(withDoctype(text(parts, "[Content_Types].xml")));

    expectRefused(parts);
  });

  it.each(ENCODING_NAMES)("refuses a plain deck whose declaration carries a DOCTYPE, %s", (encoding) => {
    const parts = pptxParts();
    parts["[Content_Types].xml"] = ENCODINGS[encoding]!(withDoctype(text(parts, "[Content_Types].xml")));

    expectRefused(parts);
  });

  it("refuses a declaration this port cannot decode, and so cannot vouch for", () => {
    const parts = pptxParts();
    parts["[Content_Types].xml"] = enc.encode(
      '<?xml version="1.0" encoding="UTF-7"?>+ADw-+ACE-DOCTYPE r +AFs-+ADw-+ACE-ENTITY x +ACI-HSINT+ACI-+AD4-+AF0-+AD4-+ADw-Types/+AD4-',
    );

    expectRefused(parts);
  });

  it("refuses the conversion too", () => {
    const parts = pptxParts();
    parts["[Content_Types].xml"] = enc.encode(withDoctype(text(parts, "[Content_Types].xml")));

    expect(() => Agent.convertTemplate(zipOf(parts))).toThrow(ArchiveRefused);
  });

  it("does not refuse a declaration for text that only looks like a DOCTYPE", () => {
    const parts = pptxParts();
    const clean = readText(parts);
    parts["[Content_Types].xml"] = enc.encode(
      withDoctype(text(parts, "[Content_Types].xml"), "<!-- <!DOCTYPE x> -->").replace("</Types>", "<!-- <!DOCTYPE x> --></Types>"),
    );

    expect(readText(parts)).toBe(clean);
  });
});

describe("external entities", () => {
  let dir: string;
  let url: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ds-dt-"));
    const canary = join(dir, "canary.txt");
    writeFileSync(canary, "HSCANARY");
    url = `file:///${canary.replace(/\\/g, "/")}`;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.each(MARKER_PARTS)("neither loads nor leaks a file entity, %s", (part) => {
    const parts = pptxParts();
    parts[part] = enc.encode(withDoctype(referencing(parts, part), `<!DOCTYPE r [<!ENTITY x SYSTEM "${url}">]>`));

    expect(readFileSync(url.replace("file:///", ""), "utf8")).toBe("HSCANARY");
    expect(readText(parts)).not.toContain("HSCANARY");
  });
});

describe("text that only looks like a DOCTYPE", () => {
  it("is kept in a slide written as CDATA", () => {
    const parts = pptxParts();
    parts["ppt/slides/slide1.xml"] = enc.encode(text(parts, "ppt/slides/slide1.xml").split(MARKER).join("<![CDATA[<!DOCTYPE html>]]>"));

    expect(readText(parts)).toContain("<!DOCTYPE html>");
  });

  it("is kept in a chart title written as CDATA", () => {
    const parts = pptxParts();
    parts["ppt/charts/chart1.xml"] = enc.encode(text(parts, "ppt/charts/chart1.xml").split(MARKER).join("<![CDATA[<!DOCTYPE html>]]>"));

    expect(read(parts).slides[0].elements[1].option.title.text).toBe("<!DOCTYPE html>");
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
    const parts = pptxParts();
    parts["ppt/slides/slide1.xml"] = concat([0xff, 0xfe], utf16le(`<!-- ⴭ> x -->${DOCTYPE}<r>&x;</r>`));

    expect(read(parts).slides[0].elements).toEqual([]);
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
          if (/<!DOCTYPE/i.test(source) || /DECODER\.decode/.test(source) || /UTF8\.decode\(xml\)/.test(source) || /new DOMParser/.test(source)) {
            offenders.push(name);
          }
        }
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
  });
});
