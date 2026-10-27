/**
 * Office TEMPLATE packages: `.potx` for this package. Mirrors PHP
 * `DarkSlide\Archive\OfficeTemplate` (same family table, reason codes and
 * byte layout of a converted archive).
 *
 * A `.potx` is its `.pptx` twin with `/ppt/presentation.xml` declared
 * `...presentationml.template.main+xml` in `[Content_Types].xml` instead of
 * `...presentation.main+xml`. Reading one is classifying it; converting one is
 * rewriting that value while every other member is copied as its original raw
 * zip record: same compressed bytes, same CRC, same timestamps.
 *
 * dark-slide has no OpenDocument presentation reader, so `.otp` / `.odp` are
 * not classified when read (reading is unchanged) and refused by the converter
 * as `not_convertible`.
 *
 * Declarations are edited as latin1 strings (one char per byte) so the bytes
 * around the edited value survive exactly, whatever their encoding.
 *
 * Macro-enabled templates (`.dotm`, `.potm`, `.xltm`) are refused, never read
 * around. Every family is listed so a template declaring ANOTHER family is
 * recognised and refused rather than read as a presentation.
 *
 * @internal
 */
import { OfficeTemplateRefused } from "../exceptions";
import { parseXml, type XmlNode } from "../reader/xml";
import { crc32 } from "./crc32";
import { SourceArchive, type ArchiveEntry } from "./source-archive";

export type SourceKind = "document" | "template";

export const DOCUMENT: SourceKind = "document";
export const TEMPLATE: SourceKind = "template";

/** The family this package reads and converts. */
const FAMILY = "presentation";

const VBA = "application/vnd.ms-office.vbaProject";

interface Family {
  part: string;
  document: string;
  template: string;
  macroDocument: string;
  macroTemplate: string;
  odfDocument: string;
  odfTemplate: string;
  odfBody: string;
}

const FAMILIES: Record<string, Family> = {
  word: {
    part: "/word/document.xml",
    document: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    template: "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
    macroDocument: "application/vnd.ms-word.document.macroEnabled.main+xml",
    macroTemplate: "application/vnd.ms-word.template.macroEnabledTemplate.main+xml",
    odfDocument: "application/vnd.oasis.opendocument.text",
    odfTemplate: "application/vnd.oasis.opendocument.text-template",
    odfBody: "text",
  },
  presentation: {
    part: "/ppt/presentation.xml",
    document: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    template: "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml",
    macroDocument: "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml",
    macroTemplate: "application/vnd.ms-powerpoint.template.macroEnabled.main+xml",
    odfDocument: "application/vnd.oasis.opendocument.presentation",
    odfTemplate: "application/vnd.oasis.opendocument.presentation-template",
    odfBody: "presentation",
  },
  spreadsheet: {
    part: "/xl/workbook.xml",
    document: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    template: "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
    macroDocument: "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
    macroTemplate: "application/vnd.ms-excel.template.macroEnabled.main+xml",
    odfDocument: "application/vnd.oasis.opendocument.spreadsheet",
    odfTemplate: "application/vnd.oasis.opendocument.spreadsheet-template",
    odfBody: "spreadsheet",
  },
};

const OWN = FAMILIES[FAMILY]!;
const UTF8 = new TextDecoder("utf-8");

/**
 * `document` or `template`, for a package the reader is about to read. A
 * package that declares nothing a template would is a `document`, exactly as
 * before: only templates are new.
 *
 * @throws OfficeTemplateRefused `macro_enabled` or `family_mismatch`
 */
export function sourceKind(zip: SourceArchive): SourceKind {
  const types = zip.read("[Content_Types].xml");
  return types === null ? DOCUMENT : ooxmlKind(zip, types);
}

/**
 * Turn a `.potx` into its `.pptx` twin, or back. `to` null flips.
 *
 * @throws OfficeTemplateRefused
 * @throws ArchiveRefused through the archive guard
 */
export function convert(bytes: Uint8Array, to: SourceKind | null = null): Uint8Array {
  if (to !== null && to !== DOCUMENT && to !== TEMPLATE) throw new OfficeTemplateRefused("bad_target");
  const zip = SourceArchive.open(bytes);
  const kind = sourceKind(zip);
  const target: SourceKind = to ?? (kind === TEMPLATE ? DOCUMENT : TEMPLATE);
  if (target === kind) throw new OfficeTemplateRefused(`already_${kind}`);

  const types = zip.read("[Content_Types].xml");
  if (types === null) throw new OfficeTemplateRefused("not_convertible");
  const declared = declarations(types);
  if (declared === null) throw new OfficeTemplateRefused("not_convertible");
  if (hasVba(zip, declared) || typesOf(declared, OWN.part).includes(OWN.macroDocument)) {
    throw new OfficeTemplateRefused("macro_enabled");
  }
  const [from, value] = target === TEMPLATE ? [OWN.document, OWN.template] : [OWN.template, OWN.document];
  const replacements = new Map<string, Uint8Array>([
    ["[Content_Types].xml", fromLatin1(rewriteOverride(latin1(types), OWN.part, from, value))],
  ]);

  const out = rebuild(zip, replacements);
  if (sourceKind(SourceArchive.open(out)) !== target) {
    throw new Error("Template conversion did not produce the requested kind.");
  }
  return out;
}

// ─── Classification ────────────────────────────────────────────────────

function ooxmlKind(zip: SourceArchive, types: Uint8Array): SourceKind {
  const declared = declarations(types);
  if (declared === null) return DOCUMENT;
  let kind = DOCUMENT;
  for (const [part, type] of declared) {
    for (const [name, family] of Object.entries(FAMILIES)) {
      if (type !== family.template && type !== family.macroTemplate) continue;
      // A template type on a Default, on another part, or of another family.
      if (name !== FAMILY || part !== asciiLower(OWN.part)) throw new OfficeTemplateRefused("family_mismatch");
      if (type === family.macroTemplate) throw new OfficeTemplateRefused("macro_enabled");
      kind = TEMPLATE;
    }
  }
  if (kind === TEMPLATE && hasVba(zip, declared)) throw new OfficeTemplateRefused("macro_enabled");
  return kind;
}

/** Every content-type declaration as [ASCII-lowercased part name or `*.ext`, type], by local name. */
function declarations(types: Uint8Array | string): [string, string][] | null {
  const root = dom(types);
  if (root === null) return null;
  const out: [string, string][] = [];
  for (const el of elements(root)) {
    if (el.name === "Override") out.push([asciiLower(el.attrs.PartName ?? ""), el.attrs.ContentType ?? ""]);
    else if (el.name === "Default") out.push([`*.${asciiLower(el.attrs.Extension ?? "")}`, el.attrs.ContentType ?? ""]);
  }
  return out;
}

function typesOf(declared: [string, string][], part: string): string[] {
  return declared.filter(([name]) => name === asciiLower(part)).map(([, type]) => type);
}

function hasVba(zip: SourceArchive, declared: [string, string][]): boolean {
  if (declared.some(([, type]) => asciiLower(type) === asciiLower(VBA))) return true;
  return zip.names().some((name) => /(^|\/)vbaProject\.bin$/i.test(name));
}

// ─── Rewriting ─────────────────────────────────────────────────────────

/**
 * Replace one attribute VALUE in place. A text scan finds the candidate; the
 * parser then has to agree on the result, which is what stops a decoy in a
 * comment or an entity-encoded name from steering the edit.
 */
function rewriteOverride(xml: string, part: string, from: string, to: string): string {
  const hits: number[] = [];
  for (const tag of xml.matchAll(/<(?:[A-Za-z_][\w.\-]*:)?Override\b[^>]*>/g)) {
    const name = /\sPartName\s*=\s*(["'])(.*?)\1/s.exec(tag[0]);
    if (name === null || asciiLower(name[2]!) !== asciiLower(part)) continue;
    const type = /\sContentType\s*=\s*(["'])(.*?)\1/s.exec(tag[0]);
    if (type !== null && type[2] === from) hits.push(tag.index! + type.index + type[0].indexOf(type[1]!) + 1);
  }
  if (hits.length !== 1) throw new OfficeTemplateRefused("not_convertible");
  const out = xml.slice(0, hits[0]) + to + xml.slice(hits[0]! + from.length);
  const declared = declarations(out);
  const after = declared === null ? [] : typesOf(declared, part);
  if (after.length !== 1 || after[0] !== to) throw new OfficeTemplateRefused("not_convertible");
  return out;
}

/**
 * Re-assemble the archive. Untouched members are their original local records,
 * verbatim; a replaced member is written STORED with its original timestamp and
 * no extra field. Local order and central order are both kept.
 */
function rebuild(zip: SourceArchive, replacements: Map<string, Uint8Array>): Uint8Array {
  const original = zip.toBytes();
  const view = new DataView(original.buffer, original.byteOffset, original.byteLength);
  const u16 = (at: number): number => view.getUint16(at, true);
  const u32 = (at: number): number => view.getUint32(at, true);
  const entries = zip.entries();
  const byLocal = [...entries].sort((a, b) => a.local - b.local);
  const nameBytes = (entry: ArchiveEntry): Uint8Array => original.subarray(entry.central + 46, entry.central + 46 + u16(entry.central + 28));

  const chunks: Uint8Array[] = [];
  const offsets = new Map<string, number>();
  let length = 0;
  const push = (chunk: Uint8Array): void => { chunks.push(chunk); length += chunk.length; };

  for (const entry of byLocal) {
    offsets.set(entry.name, length);
    const data = replacements.get(entry.name);
    if (data === undefined) {
      push(original.subarray(entry.local, entry.finish));
      continue;
    }
    const name = nameBytes(entry);
    const header = new Uint8Array(30 + name.length + data.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x04034b50, true); hv.setUint16(4, 10, true); hv.setUint16(6, entry.flags & 0x0800, true);
    hv.setUint16(8, 0, true); hv.setUint16(10, u16(entry.local + 10), true); hv.setUint16(12, u16(entry.local + 12), true);
    hv.setUint32(14, crc32(data) >>> 0, true); hv.setUint32(18, data.length, true); hv.setUint32(22, data.length, true);
    hv.setUint16(26, name.length, true); hv.setUint16(28, 0, true);
    header.set(name, 30); header.set(data, 30 + name.length);
    push(header);
  }
  const localsLength = length;

  for (const entry of entries) {
    const data = replacements.get(entry.name);
    if (data === undefined) {
      const record = original.slice(entry.central, entry.central + entry.centralLength);
      new DataView(record.buffer).setUint32(42, offsets.get(entry.name)!, true);
      push(record);
      continue;
    }
    const name = nameBytes(entry);
    const at = entry.central;
    const record = new Uint8Array(46 + name.length);
    const rv = new DataView(record.buffer);
    rv.setUint32(0, 0x02014b50, true); rv.setUint16(4, u16(at + 4), true); rv.setUint16(6, 10, true);
    rv.setUint16(8, entry.flags & 0x0800, true); rv.setUint16(10, 0, true);
    rv.setUint16(12, u16(at + 12), true); rv.setUint16(14, u16(at + 14), true);
    rv.setUint32(16, crc32(data) >>> 0, true); rv.setUint32(20, data.length, true); rv.setUint32(24, data.length, true);
    rv.setUint16(28, name.length, true); rv.setUint16(36, u16(at + 36), true); rv.setUint32(38, u32(at + 38), true);
    rv.setUint32(42, offsets.get(entry.name)!, true);
    record.set(name, 46);
    push(record);
  }

  const comment = zip.comment();
  const end = new Uint8Array(22 + comment.length);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, length - localsLength, true); ev.setUint32(16, localsLength, true); ev.setUint16(20, comment.length, true);
  end.set(comment, 22);
  push(end);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const chunk of chunks) { out.set(chunk, pos); pos += chunk.length; }
  return out;
}

// ─── Helpers ───────────────────────────────────────────────────────────

/** Parse; null when absent, empty or carrying a DOCTYPE (as PHP's DOM gate). */
function dom(xml: Uint8Array | string | null): XmlNode | null {
  if (xml === null) return null;
  const text = typeof xml === "string" ? UTF8.decode(fromLatin1(xml)) : UTF8.decode(xml);
  if (text === "" || /<!DOCTYPE/i.test(text)) return null;
  return parseXml(text);
}

function* elements(root: XmlNode): Generator<XmlNode> {
  const stack: XmlNode[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    yield el;
    for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]!);
  }
}

function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
}

function fromLatin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
