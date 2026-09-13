import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, FontEmbeddingException, unzipSync } from "../../src";
import { generatedFont, withTag } from "../support/generated-font";

// Ported from PHP tests/Unit/FontEmbeddingTest.php.
//
// Embedding the host's fonts, so brand typography survives a machine without
// them. Pinned: no font supplied means no byte changes (the parity suites
// depend on it); the package shape PowerPoint's schema requires; the EOT header
// field by field (that wrapper is what makes a `.fntdata` render); and refusal,
// all at once and before anything is written.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const dec = new TextDecoder();

function feDeck(): Any {
  return {
    id: "fonts",
    title: "Embedded fonts",
    theme: { name: "probe", fonts: { heading: "Qvx Display", body: "Qvx Text" } },
    slides: [
      {
        id: "s1",
        layout: "blank",
        elements: [
          {
            id: "t",
            type: "text",
            x: 0.1,
            y: 0.3,
            w: 0.8,
            h: 0.3,
            content: "EMBEDDED FACE",
            style: { fontSize: 96, fontFamily: "Qvx Display" },
          },
        ],
      },
    ],
  };
}

function feParts(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}

function text(parts: Record<string, Uint8Array>, name: string): string {
  return dec.decode(parts[name]!);
}

function feFontsOption(): Any {
  return {
    "Qvx Display": {
      regular: generatedFont("Qvx Display"),
      bold: generatedFont("Qvx Display", { style: "Bold", weight: 700 }),
    },
    "Qvx Text": { regular: generatedFont("Qvx Text") },
  };
}

function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected a throw");
}

describe("font embedding", () => {
  it("changes nothing about a deck when no font is supplied", () => {
    const parts = feParts(Agent.toBytes(feDeck()));

    expect(Object.keys(parts).filter((n) => n.startsWith("ppt/fonts/"))).toEqual([]);
    expect(text(parts, "ppt/presentation.xml")).toContain('saveSubsetFonts="1"');
    expect(text(parts, "ppt/presentation.xml")).not.toContain("embedTrueTypeFonts");
    expect(text(parts, "ppt/presentation.xml")).not.toContain("embeddedFontLst");
    expect(text(parts, "[Content_Types].xml")).not.toContain("fntdata");
  });

  it("writes the parts, relationships and font list PowerPoint expects", () => {
    const parts = feParts(Agent.toBytes(feDeck(), { fonts: feFontsOption() }));
    const presentation = text(parts, "ppt/presentation.xml");

    // One slide: rId1 theme, rId2 slide, rId3 master, fonts from rId4.
    expect(presentation).toContain('embedTrueTypeFonts="1"');
    expect(presentation).not.toContain("saveSubsetFonts");
    expect(presentation).toContain(
      '<p:notesSz cx="5143500" cy="9144000"/>' +
        "<p:embeddedFontLst>" +
        '<p:embeddedFont><p:font typeface="Qvx Display"/><p:regular r:id="rId4"/><p:bold r:id="rId5"/></p:embeddedFont>' +
        '<p:embeddedFont><p:font typeface="Qvx Text"/><p:regular r:id="rId6"/></p:embeddedFont>' +
        "</p:embeddedFontLst></p:presentation>",
    );

    const rels = text(parts, "ppt/_rels/presentation.xml.rels");
    for (const [rid, file] of [
      [4, "font1"],
      [5, "font2"],
      [6, "font3"],
    ] as const) {
      expect(rels).toContain(
        `<Relationship Id="rId${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/${file}.fntdata"/>`,
      );
      expect(parts).toHaveProperty([`ppt/fonts/${file}.fntdata`]);
    }
    expect(text(parts, "[Content_Types].xml")).toContain('<Default Extension="fntdata" ContentType="application/x-fontdata"/>');
  });

  it("wraps each font in an uncompressed Embedded OpenType header copied from the font", () => {
    const bold = generatedFont("Qvx Display", { style: "Bold", fsType: 0x0008, weight: 700 });
    const parts = feParts(Agent.toBytes(feDeck(), { fonts: { "Qvx Display": { bold } } }));
    const eot = parts["ppt/fonts/font1.fntdata"]!;
    const view = new DataView(eot.buffer, eot.byteOffset, eot.byteLength);

    expect(view.getUint32(0, true)).toBe(eot.length); // EOTSize
    expect(view.getUint32(4, true)).toBe(bold.length); // FontDataSize
    expect(view.getUint32(8, true)).toBe(0x00020002); // Version
    expect(view.getUint32(12, true)).toBe(0); // Flags: no subsetting, compression or XOR

    expect(eot[26]).toBe(1); // Charset: DEFAULT_CHARSET
    expect(eot[27]).toBe(0); // Italic
    expect(view.getUint32(28, true)).toBe(700); // Weight
    expect(view.getUint16(32, true)).toBe(0x0008); // fsType
    expect(view.getUint16(34, true)).toBe(0x504c); // MagicNumber

    // FamilyName: Padding1 at 80, size at 82, UTF-16LE with its trailing NUL.
    const size = view.getUint16(82, true);
    const expected = "Qvx Display\0";
    expect(size).toBe(expected.length * 2);
    let family = "";
    for (let i = 0; i < size; i += 2) family += String.fromCharCode(view.getUint16(84 + i, true));
    expect(family).toBe(expected);

    // The font itself follows the header untouched.
    expect(Buffer.from(eot.subarray(eot.length - bold.length)).equals(Buffer.from(bold))).toBe(true);
  });

  it("accepts the font as an ArrayBuffer as well as a Uint8Array", () => {
    const font = generatedFont("Qvx Display");
    const buffer = font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength);
    const parts = feParts(Agent.toBytes(feDeck(), { fonts: { "Qvx Display": { regular: buffer } } }));

    expect(parts).toHaveProperty(["ppt/fonts/font1.fntdata"]);
  });

  it("embeds a font whose licence permits preview and print or editing", () => {
    for (const fsType of [0x0000, 0x0004, 0x0008, 0x0002 | 0x0004]) {
      const font = generatedFont("Qvx Display", { fsType });
      const parts = feParts(Agent.toBytes(feDeck(), { fonts: { "Qvx Display": { regular: font } } }));
      expect(parts, `fsType 0x${fsType.toString(16)}`).toHaveProperty(["ppt/fonts/font1.fntdata"]);
    }
  });

  it.each([
    ["restricted licence", 0x0002, "its licence forbids embedding (OS/2 fsType 0x0002, Restricted License)"],
    ["bitmap embedding only", 0x0200, "its licence allows bitmap embedding only (OS/2 fsType 0x0200)"],
  ])("refuses a font whose licence forbids embedding: %s", (_label, fsType, reason) => {
    const font = generatedFont("Qvx Display", { fsType });
    const error = thrown(() => Agent.toBytes(feDeck(), { fonts: { "Qvx Display": { regular: font } } }));

    expect(error).toBeInstanceOf(FontEmbeddingException);
    expect(error.message).toContain(reason);
  });

  it.each([
    [
      "CFF OpenType",
      () => withTag(generatedFont("Qvx Display"), "OTTO"),
      "CFF-outline OpenType (.otf) is not embedded yet; supply the TrueType-outline (.ttf) build of the font",
    ],
    [
      "font collection",
      () => withTag(generatedFont("Qvx Display"), "ttcf"),
      "a font collection (.ttc) holds several fonts; supply the single font file",
    ],
    [
      "a different family",
      () => generatedFont("Somebody Else"),
      "the file's family name is 'Somebody Else', not 'Qvx Display'; a deck references a face by that name, so this font would never be used",
    ],
    ["no bytes", () => new Uint8Array(0), "expected the font bytes (a Uint8Array or ArrayBuffer)"],
  ])("refuses files it cannot embed, naming the typeface and variant: %s", (_label, font, reason) => {
    const error = thrown(() => Agent.toBytes(feDeck(), { fonts: { "Qvx Display": { regular: font() } } }));

    expect(error).toBeInstanceOf(FontEmbeddingException);
    expect(error.message).toContain("Qvx Display (regular): " + reason);
  });

  it("reports every problem at once and writes nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fe-refused-"));
    const path = join(dir, "refused.pptx");

    const error = await Agent.write(feDeck(), path, {
      fonts: {
        "Qvx Display": { regular: generatedFont("Qvx Display", { fsType: 0x0002 }), heavy: new Uint8Array([1]) } as Any,
        "Qvx Text": { regular: generatedFont("Wrong Name") },
      },
    }).then(
      () => null,
      (e: Error) => e,
    );

    expect(error).toBeInstanceOf(FontEmbeddingException);
    expect(error!.message.startsWith("These fonts cannot be embedded:\n- ")).toBe(true);
    expect(error!.message).toContain("Qvx Display: 'heavy' is not a variant; use regular, bold, italic, boldItalic");
    expect(error!.message).toContain("Qvx Display (regular): its licence forbids embedding");
    expect(error!.message).toContain("Qvx Text (regular): the file's family name is 'Wrong Name'");
    expect(() => readFileSync(path)).toThrow();
  });

  it("reads back which typefaces and variants a file embeds, and never the bytes", () => {
    const deck = Agent.read(Agent.toBytes(feDeck(), { fonts: feFontsOption() })) as Any;

    expect(deck.metadata.embeddedFonts).toEqual([
      { typeface: "Qvx Display", variants: ["regular", "bold"] },
      { typeface: "Qvx Text", variants: ["regular"] },
    ]);
  });

  it("reports no embedded fonts for a deck without them", () => {
    const deck = Agent.read(Agent.toBytes(feDeck())) as Any;

    expect(deck).not.toHaveProperty("metadata");
  });

  /**
   * The rendered proof: LibreOffice uses the embedded face, and falls back
   * without it. Opt-in (DARK_SLIDE_RENDER=1), as in the PHP suite.
   */
  it.skipIf(process.env.DARK_SLIDE_RENDER !== "1")(
    "renders in the embedded face in LibreOffice, and falls back without it",
    () => {
      const soffice =
        process.env.DARK_SLIDE_SOFFICE ??
        (process.platform === "win32" ? "C:/Program Files/LibreOffice/program/soffice.com" : "soffice");
      const dir = mkdtempSync(join(tmpdir(), "fe-render-"));

      // A face no machine has, so only the embedded copy can produce it.
      const family = "Qvx Render " + Math.random().toString(16).slice(2, 6).toUpperCase();
      const deck = feDeck();
      deck.theme.fonts = { heading: family, body: family };
      deck.slides[0].elements[0].style.fontFamily = family;

      writeFileSync(join(dir, "embedded.pptx"), Agent.toBytes(deck, { fonts: { [family]: { regular: generatedFont(family) } } }));
      writeFileSync(join(dir, "fallback.pptx"), Agent.toBytes(deck));

      const profile = "file:///" + dir.replace(/\\/g, "/").replace(/^\//, "") + "/profile";
      spawnSync(soffice, [`-env:UserInstallation=${profile}`, "--headless", "--convert-to", "pdf", "--outdir", dir, join(dir, "embedded.pptx"), join(dir, "fallback.pptx")]);

      const postscriptName = family.replace(/ /g, "") + "-Regular";
      const embedded = readFileSync(join(dir, "embedded.pdf")).toString("latin1");
      const fallback = readFileSync(join(dir, "fallback.pdf")).toString("latin1");
      expect(embedded).toContain(postscriptName);
      expect(fallback).not.toContain(postscriptName);
      // The fallback must have rendered SOMETHING, or the line above proves nothing.
      expect(fallback).toContain("/BaseFont");
    },
    120_000,
  );
});
