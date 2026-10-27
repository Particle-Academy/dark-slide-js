/**
 * PowerPoint .potx templates. Mirrors PHP tests/Unit/OfficeTemplateTest.php.
 *
 * A .potx IS its .pptx twin with /ppt/presentation.xml declared
 * `presentationml.template.main+xml`. The reader marks `sourceKind:
 * "template"`; the converter flips that one value and copies every other zip
 * member as its original record. dark-slide reads no OpenDocument
 * presentations, so .otp/.odp are refused by the converter.
 *
 * Fixtures are built here (zipSync, or a DEFLATE zip via node:zlib so the raw
 * record copy is actually exercised), never by the production converter.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { Agent, ArchiveRefused, OfficeTemplateRefused, PptxReader, convertTemplate, unzipSync, zipSync } from "../src";
import { crc32 } from "../src/zip";
import { run } from "../src/cli-run";

const DOC = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
const TEMPLATE = "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml";
const MACRO_TEMPLATE = "application/vnd.ms-powerpoint.template.macroEnabled.main+xml";
const MACRO_DOC = "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml";
const WORD_TEMPLATE = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml";

const enc = new TextEncoder();
const dec = new TextDecoder();

function deck(): Record<string, unknown> {
  return {
    id: "brand",
    title: "Brand Deck",
    theme: { name: "default" },
    slides: [{
      id: "s1",
      layout: "blank",
      elements: [
        { id: "t1", type: "text", content: "Quarterly review", x: 0.1, y: 0.1, w: 0.8, h: 0.2 },
        { id: "r1", type: "shape", shape: "rounded-rect", x: 0.1, y: 0.5, w: 0.3, h: 0.3, fill: "#FF0000" },
      ],
      notes: "Speaker notes survive",
    }],
  };
}

/** A DEFLATE zip, local records in order, so raw-record copying is observable. */
function zipDeflated(entries: [string, Uint8Array][]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = enc.encode(name);
    const stored = name === "mimetype";
    const body = stored ? data : new Uint8Array(deflateRawSync(data));
    const crc = crc32(data) >>> 0;
    const lh = new Uint8Array(30 + n.length);
    const l = new DataView(lh.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true);
    l.setUint16(8, stored ? 0 : 8, true); l.setUint16(10, 0x6000, true); l.setUint16(12, 0x5b21, true);
    l.setUint32(14, crc, true); l.setUint32(18, body.length, true); l.setUint32(22, data.length, true);
    l.setUint16(26, n.length, true); lh.set(n, 30);
    const ch = new Uint8Array(46 + n.length);
    const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, stored ? 0 : 8, true); c.setUint16(12, 0x6000, true); c.setUint16(14, 0x5b21, true);
    c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, n.length, true); c.setUint32(42, offset, true); ch.set(n, 46);
    locals.push(lh, body); centrals.push(ch);
    offset += lh.length + body.length;
  }
  const centralLength = centrals.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
  e.setUint32(12, centralLength, true); e.setUint32(16, offset, true);
  const all = [...locals, ...centrals, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

/** name -> raw local record bytes (header + compressed data), read independently. */
function rawRecords(bytes: Uint8Array): Map<string, { method: number; data: Uint8Array }> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (v.getUint32(end, true) !== 0x06054b50) end--;
  let at = v.getUint32(end + 16, true);
  const out = new Map<string, { method: number; data: Uint8Array }>();
  for (let i = 0; i < v.getUint16(end + 10, true); i++) {
    const nameLength = v.getUint16(at + 28, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const local = v.getUint32(at + 42, true);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out.set(name, { method: v.getUint16(at + 10, true), data: bytes.slice(start, start + v.getUint32(at + 20, true)) });
    at += 46 + nameLength + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
  return out;
}

function entries(bytes: Uint8Array): [string, Uint8Array][] {
  return Object.entries(unzipSync(bytes));
}

function pptx(): Uint8Array {
  return zipDeflated(entries(Agent.toBytes(deck() as never)));
}

function retyped(type: string, extra: [string, Uint8Array][] = []): Uint8Array {
  const out = entries(pptx()).map(([name, data]): [string, Uint8Array] =>
    name === "[Content_Types].xml" ? [name, enc.encode(dec.decode(data).replace(DOC, type))] : [name, data]);
  return zipDeflated([...out, ...extra]);
}

const potx = (): Uint8Array => retyped(TEMPLATE);
const read = (bytes: Uint8Array): Record<string, unknown> => new PptxReader().fromBytes(bytes);

function refused(action: () => unknown, reason: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(OfficeTemplateRefused);
    expect((error as OfficeTemplateRefused).reason).toBe(reason);
    return;
  }
  throw new Error(`Expected a ${reason} refusal; the input was accepted.`);
}

function archiveRefused(action: () => unknown, reason: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ArchiveRefused);
    expect((error as ArchiveRefused).reason).toBe(reason);
    return;
  }
  throw new Error(`Expected archive refusal ${reason}; the input was accepted.`);
}

function withContentTypes(edit: (xml: string) => string, source = pptx()): Uint8Array {
  return zipDeflated(entries(source).map(([name, data]): [string, Uint8Array] =>
    name === "[Content_Types].xml" ? [name, enc.encode(edit(dec.decode(data)))] : [name, data]));
}

describe("reading", () => {
  it("reads a .potx and marks it as a template, with the twin's deck id", () => {
    const document = read(pptx());
    const template = read(potx());
    expect(template.sourceKind).toBe("template");
    expect(template.id).toBe(document.id);
    delete template.sourceKind;
    expect(template).toEqual(document);
  });

  it("leaves a .pptx read exactly as it was: no sourceKind key", () => {
    expect(read(pptx())).not.toHaveProperty("sourceKind");
    expect(Agent.read(pptx())).not.toHaveProperty("sourceKind");
  });

  it("refuses a macro-enabled .potm", () => {
    refused(() => read(retyped(MACRO_TEMPLATE)), "macro_enabled");
  });

  it("refuses a .potx that carries a VBA project anyway", () => {
    refused(() => read(retyped(TEMPLATE, [["ppt/vbaProject.bin", enc.encode("not really")]])), "macro_enabled");
  });

  it("still reads a macro-enabled PRESENTATION (.pptm) as before", () => {
    expect(read(retyped(MACRO_DOC))).not.toHaveProperty("sourceKind");
  });
});

describe("hostile input", () => {
  it("refuses a template whose content type claims another family", () => {
    refused(() => read(retyped(WORD_TEMPLATE)), "family_mismatch");
    refused(() => read(withContentTypes((x) => x.replace("</Types>",
      `<Override PartName="/word/document.xml" ContentType="${WORD_TEMPLATE}"/></Types>`))), "family_mismatch");
    refused(() => read(withContentTypes((x) => x.replace('ContentType="application/xml"', `ContentType="${TEMPLATE}"`))), "family_mismatch");
  });

  it("refuses a template zip bomb through the archive guard, reading and converting", () => {
    const bomb = retyped(TEMPLATE, [["ppt/media/bomb.bin", new Uint8Array(65 * 1024 * 1024)]]);
    archiveRefused(() => read(bomb), "archive_limit");
    archiveRefused(() => convertTemplate(bomb), "archive_limit");
  });

  it("refuses a template with a traversing entry name, reading and converting", () => {
    const evil = retyped(TEMPLATE, [["../evil.xml", enc.encode("<x/>")]]);
    archiveRefused(() => read(evil), "archive_path");
    archiveRefused(() => convertTemplate(evil), "archive_path");
  });
});

describe("converting", () => {
  it("converts .potx to .pptx changing only the content-type value; other records are raw copies", () => {
    const source = potx();
    const out = Agent.convertTemplate(source, "document");
    const before = entries(source);
    const after = entries(out);
    expect(after.map(([n]) => n)).toEqual(before.map(([n]) => n));
    const raw = rawRecords(source);
    const rawAfter = rawRecords(out);
    for (const [name, data] of before) {
      const now = after.find(([n]) => n === name)![1];
      if (name === "[Content_Types].xml") {
        expect(dec.decode(now)).toBe(dec.decode(data).replace(TEMPLATE, DOC));
      } else {
        expect(now).toEqual(data);
        expect(rawAfter.get(name)).toEqual(raw.get(name));
      }
    }
    expect(read(out)).not.toHaveProperty("sourceKind");
  });

  it("round-trips pptx -> potx -> pptx with every part byte-identical", () => {
    const source = pptx();
    const template = convertTemplate(source, "template");
    expect(read(template).sourceKind).toBe("template");
    expect(entries(convertTemplate(template, "document"))).toEqual(entries(source));
  });

  it("flips direction when no target is given", () => {
    expect(read(convertTemplate(pptx())).sourceKind).toBe("template");
    expect(read(convertTemplate(potx()))).not.toHaveProperty("sourceKind");
  });

  it("refuses conversions it must not make", () => {
    refused(() => convertTemplate(potx(), "template"), "already_template");
    refused(() => convertTemplate(pptx(), "document"), "already_document");
    refused(() => convertTemplate(retyped(MACRO_TEMPLATE), "document"), "macro_enabled");
    refused(() => convertTemplate(retyped(MACRO_DOC), "template"), "macro_enabled");
    refused(() => convertTemplate(pptx(), "spreadsheet" as never), "bad_target");
    refused(() => convertTemplate(retyped(WORD_TEMPLATE)), "family_mismatch");
  });

  it("does not handle OpenDocument presentations: no ODF presentation reader exists here", () => {
    for (const type of ["application/vnd.oasis.opendocument.presentation", "application/vnd.oasis.opendocument.presentation-template"]) {
      const odf = zipSync([{ name: "mimetype", data: enc.encode(type) }, { name: "content.xml", data: enc.encode("<x/>") }]);
      refused(() => convertTemplate(odf), "not_convertible");
    }
  });

  it("refuses to convert a Word document it does not own", () => {
    const docx = zipSync([
      { name: "[Content_Types].xml", data: enc.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
      { name: "word/document.xml", data: enc.encode("<w:document/>") },
    ]);
    refused(() => convertTemplate(docx), "not_convertible");
  });

  it("refuses a declaration it cannot rewrite unambiguously", () => {
    const decoy = withContentTypes((x) => x.replace('<Override PartName="/ppt/presentation.xml"',
      `<!-- <Override PartName="/ppt/presentation.xml" ContentType="${TEMPLATE}"/> --><Override PartName="/ppt/presentation.xml"`), potx());
    refused(() => convertTemplate(decoy), "not_convertible");
  });
});

describe("template:convert CLI", () => {
  it("converts, refuses and explains", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsj-cli-"));
    const io = { out: "", err: "" };
    const sink = { stdout: (s: string) => { io.out += s; }, stderr: (s: string) => { io.err += s; } };
    writeFileSync(join(dir, "in.potx"), potx());

    expect(run(["template:convert", join(dir, "in.potx"), join(dir, "out.pptx")], sink)).toBe(0);
    expect(io.out).toContain("document");
    expect(read(readFileSync(join(dir, "out.pptx")))).not.toHaveProperty("sourceKind");

    expect(run(["template:convert", join(dir, "out.pptx"), join(dir, "out.pptx"), "--to=template"], sink)).toBe(1);
    expect(io.err).toContain("exists");

    expect(run(["template:convert", join(dir, "out.pptx"), join(dir, "back.potx"), "--to=template"], sink)).toBe(0);
    expect(read(readFileSync(join(dir, "back.potx"))).sourceKind).toBe("template");

    writeFileSync(join(dir, "macro.potm"), retyped(MACRO_TEMPLATE));
    expect(run(["template:convert", join(dir, "macro.potm"), join(dir, "macro.pptx")], sink)).toBe(1);
    expect(io.err).toContain("macro_enabled");
    expect(existsSync(join(dir, "macro.pptx"))).toBe(false);

    expect(run(["template:convert"], sink)).toBe(2);
    expect(io.err).toContain("Usage");
    rmSync(dir, { recursive: true, force: true });
  });
});

const SOFFICE = process.env.LIBREOFFICE_BIN
  ?? ["C:/Program Files/LibreOffice/program/soffice.com", "/usr/bin/soffice", "/usr/local/bin/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice"].find((p) => existsSync(p));

/** Headless convert with a SHORT profile path (long ones crash LO on Windows). */
function libreOffice(input: string, format: string, outDir: string): string {
  const profile = mkdtempSync(join(tmpdir(), "dsl"));
  const url = "file:///" + profile.split(String.fromCharCode(92)).join("/").replace(/^\/+/, "");
  const result = spawnSync(SOFFICE!, [`-env:UserInstallation=${url}`, "--headless", "--norestore",
    "--convert-to", format, "--outdir", outDir, input], { encoding: "utf8", timeout: 120_000 });
  const base = input.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
  const out = join(outDir, `${base}.${format.split(":")[0]}`);
  expect(result.status).toBe(0);
  expect(existsSync(out)).toBe(true);
  return out;
}

describe.skipIf(SOFFICE === undefined)("LibreOffice as an oracle", () => {
  it("reads LibreOffice's .potx, and LibreOffice opens our conversion", () => {
    const dir = mkdtempSync(join(tmpdir(), "dso"));
    writeFileSync(join(dir, "src.pptx"), Agent.toBytes(deck() as never));
    const loTemplate = libreOffice(join(dir, "src.pptx"), "potx", dir);
    const readBack = read(readFileSync(loTemplate));
    expect(readBack.sourceKind).toBe("template");
    expect(JSON.stringify(readBack)).toContain("Quarterly review");

    mkdirSync(join(dir, "lo"));
    expect(read(readFileSync(libreOffice(loTemplate, "pptx", join(dir, "lo"))))).not.toHaveProperty("sourceKind");

    writeFileSync(join(dir, "ours.pptx"), convertTemplate(readFileSync(loTemplate), "document"));
    mkdirSync(join(dir, "ours"));
    const odp = libreOffice(join(dir, "ours.pptx"), "odp", join(dir, "ours"));
    expect(dec.decode(unzipSync(readFileSync(odp))["content.xml"])).toContain("Quarterly review");
    rmSync(dir, { recursive: true, force: true });
  }, 120_000);
});
