/**
 * Wraps a TrueType font in an Embedded OpenType (EOT) header, uncompressed.
 * Mirrors PHP `Fonts\EmbeddedOpenType` byte for byte.
 *
 * A `.pptx` stores an embedded font as `ppt/fonts/fontN.fntdata`, and the bytes
 * in that part are an EOT, not a `.ttf`. Verified by rendering in LibreOffice 26:
 * an EOT-wrapped `.fntdata` rendered in the embedded face; the same font stored
 * raw, or with Word's GUID obfuscation, fell back to another face.
 *
 * Uncompressed (Flags 0) on purpose: LibreOffice's libeot cannot decompress
 * MicroType Express.
 *
 * Layout (EOT version 0x00020002), little-endian unlike the font inside it:
 *
 *   EOTSize, FontDataSize, Version, Flags          4 x ULONG
 *   FontPANOSE                                     10 bytes
 *   Charset (1, DEFAULT_CHARSET), Italic           BYTE, BYTE
 *   Weight                                         ULONG
 *   fsType, MagicNumber 0x504C                     USHORT, USHORT
 *   UnicodeRange1..4, CodePageRange1..2            6 x ULONG
 *   CheckSumAdjustment, Reserved1..4               5 x ULONG
 *   (Padding, NameSize, UTF-16LE name + NUL) x 4   family, style, version, full
 *   Padding5, RootStringSize (0)
 *   RootStringCheckSum, EUDCCodePage               ULONG, ULONG
 *   Padding6, SignatureSize (0), EUDCFlags, EUDCFontSize (0)
 *   FontData
 */
import type { TrueTypeFont } from "./true-type-font";

export const EOT_VERSION = 0x00020002;
export const EOT_MAGIC = 0x504c;

/** RootStringCheckSum for an empty root string: the XOR key itself. */
const ROOT_STRING_CHECKSUM = 0x50475342;
const WINDOWS_1252 = 1252;

class LittleEndianBuffer {
  private parts: Uint8Array[] = [];

  bytes(b: Uint8Array): this {
    this.parts.push(b);
    return this;
  }

  u8(...values: number[]): this {
    this.parts.push(Uint8Array.from(values));
    return this;
  }

  u16(...values: number[]): this {
    const out = new Uint8Array(values.length * 2);
    const view = new DataView(out.buffer);
    values.forEach((v, i) => view.setUint16(i * 2, v, true));
    this.parts.push(out);
    return this;
  }

  u32(...values: number[]): this {
    const out = new Uint8Array(values.length * 4);
    const view = new DataView(out.buffer);
    values.forEach((v, i) => view.setUint32(i * 4, v >>> 0, true));
    this.parts.push(out);
    return this;
  }

  length(): number {
    return this.parts.reduce((n, p) => n + p.length, 0);
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length());
    let offset = 0;
    for (const p of this.parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }
}

function nameField(value: string): Uint8Array {
  const text = value + "\0";
  const utf16 = new Uint8Array(text.length * 2);
  const view = new DataView(utf16.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
  return new LittleEndianBuffer().u16(0, utf16.length).bytes(utf16).concat();
}

export const EmbeddedOpenType = {
  VERSION: EOT_VERSION,
  MAGIC: EOT_MAGIC,

  wrap(font: TrueTypeFont, family: string): Uint8Array {
    const [u1, u2, u3, u4] = font.unicodeRanges();
    const [c1, c2] = font.codePageRanges();

    const body = new LittleEndianBuffer()
      .bytes(font.panose())
      .u8(1, font.isItalic() ? 1 : 0)
      .u32(font.weight())
      .u16(font.fsType(), EOT_MAGIC)
      .u32(u1, u2, u3, u4)
      .u32(c1, c2)
      .u32(font.checkSumAdjustment())
      .u32(0, 0, 0, 0)
      .bytes(nameField(family))
      .bytes(nameField(font.name(2) ?? "Regular"))
      .bytes(nameField(font.name(5) ?? ""))
      .bytes(nameField(font.name(4) ?? family))
      .u16(0, 0)
      .u32(ROOT_STRING_CHECKSUM, WINDOWS_1252)
      .u16(0, 0)
      .u32(0, 0)
      .concat();

    const headerLength = 16 + body.length;
    const dataLength = font.bytes.length;

    return new LittleEndianBuffer()
      .u32(headerLength + dataLength, dataLength, EOT_VERSION, 0)
      .bytes(body)
      .bytes(font.bytes)
      .concat();
  },
};
