/**
 * The handful of TrueType fields that embedding a font in a `.pptx` needs.
 * Mirrors PHP `Fonts\TrueTypeFont`, including every refusal message.
 *
 * Not a font parser in any wider sense: it reads the table directory, the OS/2
 * fields the Embedded OpenType header copies, `head.checkSumAdjustment`, and the
 * name records. Nothing is subset, hinted or rewritten; the font bytes go into
 * the file exactly as supplied.
 *
 * Refuses, rather than guesses at, anything it cannot embed safely: a font
 * collection (`ttcf`), CFF-outline OpenType (`OTTO` — LibreOffice renders one,
 * PowerPoint's acceptance is unverified), and a file missing a table the header
 * needs.
 */
import { FontEmbeddingException } from "./font-embedding-exception";

interface TableRecord {
  offset: number;
  length: number;
}

function latin1(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

export class TrueTypeFont {
  private constructor(
    readonly bytes: Uint8Array,
    private readonly tables: Map<string, TableRecord>,
  ) {}

  static fromBytes(bytes: Uint8Array): TrueTypeFont {
    if (bytes.length < 12) {
      throw new FontEmbeddingException("not a font file: shorter than a table directory");
    }

    const tag = latin1(bytes, 0, 4);
    if (tag === "ttcf") {
      throw new FontEmbeddingException("a font collection (.ttc) holds several fonts; supply the single font file");
    }
    if (tag === "OTTO") {
      throw new FontEmbeddingException(
        "CFF-outline OpenType (.otf) is not embedded yet; supply the TrueType-outline (.ttf) build of the font",
      );
    }
    if (tag !== "\x00\x01\x00\x00" && tag !== "true") {
      throw new FontEmbeddingException("not a TrueType font file");
    }

    const count = u16(bytes, 4);
    if (bytes.length < 12 + 16 * count) {
      throw new FontEmbeddingException("not a font file: the table directory is truncated");
    }

    const tables = new Map<string, TableRecord>();
    for (let i = 0; i < count; i++) {
      const record = 12 + 16 * i;
      const offset = u32(bytes, record + 8);
      const length = u32(bytes, record + 12);
      if (offset + length > bytes.length) {
        throw new FontEmbeddingException("not a font file: a table runs past the end of the file");
      }
      tables.set(latin1(bytes, record, 4), { offset, length });
    }

    for (const required of ["OS/2", "head", "name", "glyf"]) {
      if (!tables.has(required)) {
        throw new FontEmbeddingException(`not an embeddable TrueType font: it has no '${required}' table`);
      }
    }
    if (tables.get("OS/2")!.length < 78 || tables.get("head")!.length < 12) {
      throw new FontEmbeddingException("not an embeddable TrueType font: its OS/2 or head table is too short");
    }

    return new TrueTypeFont(bytes, tables);
  }

  /** OS/2 `fsType`: the embedding permissions the font's licence grants. */
  fsType(): number {
    return u16(this.bytes, this.os2() + 8);
  }

  weight(): number {
    return u16(this.bytes, this.os2() + 4);
  }

  isItalic(): boolean {
    return (u16(this.bytes, this.os2() + 62) & 1) === 1;
  }

  /** The ten PANOSE classification bytes. */
  panose(): Uint8Array {
    const o = this.os2() + 32;
    return this.bytes.subarray(o, o + 10);
  }

  /** `ulUnicodeRange1..4`. */
  unicodeRanges(): [number, number, number, number] {
    const o = this.os2() + 42;
    return [u32(this.bytes, o), u32(this.bytes, o + 4), u32(this.bytes, o + 8), u32(this.bytes, o + 12)];
  }

  /** `ulCodePageRange1..2`, which only OS/2 version 1 and later carry. */
  codePageRanges(): [number, number] {
    const os2 = this.tables.get("OS/2")!;
    if (u16(this.bytes, os2.offset) < 1 || os2.length < 86) {
      return [0, 0];
    }
    return [u32(this.bytes, os2.offset + 78), u32(this.bytes, os2.offset + 82)];
  }

  checkSumAdjustment(): number {
    return u32(this.bytes, this.tables.get("head")!.offset + 8);
  }

  /**
   * A name record's text: Windows Unicode (3, 1) US English first, then any
   * Windows Unicode record, then a Macintosh Roman (1, 0) record that is plain
   * ASCII (the only range Mac Roman shares with UTF-8).
   */
  name(nameId: number): string | null {
    const table = this.tables.get("name")!.offset;
    const count = u16(this.bytes, table + 2);
    const storage = table + u16(this.bytes, table + 4);

    let best: string | null = null;
    let bestRank = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < count; i++) {
      const r = table + 6 + 12 * i;
      if (u16(this.bytes, r + 6) !== nameId) continue;

      const platform = u16(this.bytes, r);
      const encoding = u16(this.bytes, r + 2);
      const language = u16(this.bytes, r + 4);
      const length = u16(this.bytes, r + 8);
      const start = storage + u16(this.bytes, r + 10);
      const raw = this.bytes.subarray(Math.min(start, this.bytes.length), Math.min(start + length, this.bytes.length));

      let rank: number;
      let text: string;
      if (platform === 3 && encoding === 1) {
        rank = language === 0x409 ? 0 : 1;
        text = utf16be(raw);
      } else if (platform === 1 && encoding === 0 && isAscii(raw)) {
        rank = 2;
        text = latin1(raw, 0, raw.length);
      } else {
        continue;
      }
      if (rank < bestRank) {
        best = text;
        bestRank = rank;
      }
    }

    return best;
  }

  /** The family a deck would reference: the typographic family (16) when set, else the legacy one (1). */
  family(): string | null {
    return this.name(16) ?? this.name(1);
  }

  private os2(): number {
    return this.tables.get("OS/2")!.offset;
  }
}

function utf16be(raw: Uint8Array): string {
  let out = "";
  const length = raw.length - (raw.length % 2);
  for (let i = 0; i < length; i += 2) {
    out += String.fromCharCode((raw[i]! << 8) | raw[i + 1]!);
  }
  return out;
}

function isAscii(raw: Uint8Array): boolean {
  for (const b of raw) if (b > 0x7f) return false;
  return true;
}

function u16(b: Uint8Array, o: number): number {
  return (b[o]! << 8) | b[o + 1]!;
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}
