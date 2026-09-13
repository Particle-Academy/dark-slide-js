/**
 * A minimal, valid TrueType font built in memory, for tests. Port of PHP
 * `tests/Support/GeneratedFont`.
 *
 * Embedding tests need real font files, and a third-party font is not something
 * this repository takes on. So the test writes its own: ten tables (OS/2, cmap,
 * glyf, head, hhea, hmtx, loca, maxp, name, post), an empty `.notdef`, and one
 * tall box glyph for every printable ASCII character. The PHP twin's output was
 * rendered through LibreOffice 26 and used as the embedded face.
 */

class BigEndian {
  private parts: number[] = [];

  u8(...v: number[]): this {
    for (const b of v) this.parts.push(b & 0xff);
    return this;
  }

  u16(...v: number[]): this {
    for (const n of v) this.parts.push((n >> 8) & 0xff, n & 0xff);
    return this;
  }

  s16(...v: number[]): this {
    return this.u16(...v.map((n) => n & 0xffff));
  }

  u32(...v: number[]): this {
    for (const n of v) this.parts.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
    return this;
  }

  /** A 64-bit zero (LONGDATETIME fields are always 0 here). */
  zero64(): this {
    return this.u32(0, 0);
  }

  ascii(s: string): this {
    for (let i = 0; i < s.length; i++) this.parts.push(s.charCodeAt(i) & 0xff);
    return this;
  }

  bytes(b: Uint8Array): this {
    for (const x of b) this.parts.push(x);
    return this;
  }

  zeros(n: number): this {
    for (let i = 0; i < n; i++) this.parts.push(0);
    return this;
  }

  done(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

function pad4(b: Uint8Array): Uint8Array {
  const rem = (4 - (b.length % 4)) % 4;
  if (rem === 0) return b;
  const out = new Uint8Array(b.length + rem);
  out.set(b);
  return out;
}

function checksum(data: Uint8Array): number {
  const padded = pad4(data);
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  return sum;
}

function boxGlyph(x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const points: [number, number][] = [
    [x0, y0],
    [x0, y1],
    [x1, y1],
    [x1, y0],
  ];
  const g = new BigEndian().s16(1, x0, y0, x1, y1).u16(3, 0).u8(1, 1, 1, 1);
  let [px, py] = [0, 0];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of points) {
    xs.push(x - px);
    ys.push(y - py);
    [px, py] = [x, y];
  }
  g.s16(...xs).s16(...ys);
  return pad4(g.done());
}

function utf16be(ascii: string): Uint8Array {
  const out = new BigEndian();
  for (let i = 0; i < ascii.length; i++) out.u16(ascii.charCodeAt(i));
  return out.done();
}

export interface GeneratedFontOptions {
  style?: string;
  fsType?: number;
  weight?: number;
  italic?: boolean;
}

export function generatedFont(family: string, options: GeneratedFontOptions = {}): Uint8Array {
  const style = options.style ?? "Regular";
  const fsType = options.fsType ?? 0;
  const weight = options.weight ?? 400;
  const italic = options.italic ?? false;

  const firstChar = 0x20;
  const lastChar = 0x7e;
  const glyphs = 1 + (lastChar - firstChar + 1);

  const box = boxGlyph(100, 0, 500, 700);
  const glyfParts: Uint8Array[] = [];
  const offsets = [0, 0]; // .notdef is empty
  let glyfLength = 0;
  for (let i = firstChar; i <= lastChar; i++) {
    glyfParts.push(box);
    glyfLength += box.length;
    offsets.push(glyfLength);
  }
  const glyf = new BigEndian();
  for (const p of glyfParts) glyf.bytes(p);
  const loca = new BigEndian().u32(...offsets);

  const head = new BigEndian()
    .u32(0x00010000, 0x00010000, 0, 0x5f0f3cf5)
    .u16(0x000b, 1000)
    .zero64()
    .zero64()
    .s16(0, 0, 600, 800)
    .u16(italic ? 2 : weight >= 600 ? 1 : 0, 8)
    .s16(2, 1, 0);

  const hhea = new BigEndian()
    .u32(0x00010000)
    .s16(800, -200, 0)
    .u16(600)
    .s16(0, 0, 500, 1, 0, 0, 0, 0, 0, 0, 0)
    .u16(glyphs);

  const maxp = new BigEndian().u32(0x00010000).u16(glyphs, 4, 1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0);

  const hmtx = new BigEndian();
  for (let i = 0; i < glyphs; i++) hmtx.u16(600).s16(i === 0 ? 0 : 100);

  const segCount = 2;
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segCount));
  const cmap = new BigEndian()
    .u16(0, 1, 3, 1)
    .u32(12)
    .u16(4, 16 + 8 * segCount, 0)
    .u16(segCount * 2, searchRange, Math.log2(searchRange / 2), segCount * 2 - searchRange)
    .u16(lastChar, 0xffff)
    .u16(0)
    .u16(firstChar, 0xffff)
    .u16((1 - firstChar) & 0xffff, 1)
    .u16(0, 0);

  const names: [number, string][] = [
    [1, family],
    [2, style],
    [3, `${family} ${style}`],
    [4, `${family} ${style}`],
    [5, "Version 1.000"],
    [6, family.replace(/ /g, "") + "-" + style.replace(/ /g, "")],
  ];
  const records = new BigEndian();
  const strings: Uint8Array[] = [];
  let stringsLength = 0;
  for (const [id, value] of names) {
    const encoded = utf16be(value);
    records.u16(3, 1, 0x409, id, encoded.length, stringsLength);
    strings.push(encoded);
    stringsLength += encoded.length;
  }
  const name = new BigEndian().u16(0, names.length, 6 + 12 * names.length).bytes(records.done());
  for (const s of strings) name.bytes(s);

  const fsSelection = (italic ? 0x01 : 0) | (weight >= 600 ? 0x20 : 0) | (!italic && weight < 600 ? 0x40 : 0);
  const os2 = new BigEndian()
    .u16(4)
    .s16(600)
    .u16(weight, 5, fsType)
    .s16(300, 300, 0, 0, 300, 300, 0, 300, 50, 300, 0)
    .zeros(10) // PANOSE
    .u32(1, 0, 0, 0) // ulUnicodeRange1..4 (Basic Latin)
    .ascii("NONE")
    .u16(fsSelection, firstChar, lastChar)
    .s16(800, -200, 0)
    .u16(800, 200)
    .u32(1, 0) // ulCodePageRange1..2 (Latin 1)
    .s16(500, 700)
    .u16(0, 0x20, 0);

  const post = new BigEndian().u32(0x00030000, 0).s16(-100, 50).u32(0, 0, 0, 0, 0);

  const tables: [string, Uint8Array][] = [
    ["OS/2", os2.done()],
    ["cmap", cmap.done()],
    ["glyf", glyf.done()],
    ["head", head.done()],
    ["hhea", hhea.done()],
    ["hmtx", hmtx.done()],
    ["loca", loca.done()],
    ["maxp", maxp.done()],
    ["name", name.done()],
    ["post", post.done()],
  ];
  tables.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const count = tables.length;
  const selector = Math.floor(Math.log2(count));
  const range = 2 ** selector * 16;
  const directory = new BigEndian().u32(0x00010000).u16(count, range, selector, count * 16 - range);
  const body = new BigEndian();
  let offset = 12 + 16 * count;
  let bodyLength = 0;
  let headOffset = 0;
  for (const [tag, data] of tables) {
    if (tag === "head") headOffset = offset + bodyLength;
    directory.ascii(tag).u32(checksum(data), offset + bodyLength, data.length);
    const padded = pad4(data);
    body.bytes(padded);
    bodyLength += padded.length;
  }

  const dir = directory.done();
  const rest = body.done();
  const font = new Uint8Array(dir.length + rest.length);
  font.set(dir);
  font.set(rest, dir.length);

  const adjustment = (0xb1b0afba - checksum(font)) >>> 0;
  new DataView(font.buffer).setUint32(headOffset + 8, adjustment);
  return font;
}

/** The same font with its sfnt tag replaced, to stand in for a CFF `.otf` or a `.ttc`. */
export function withTag(font: Uint8Array, tag: string): Uint8Array {
  const out = font.slice();
  for (let i = 0; i < 4; i++) out[i] = tag.charCodeAt(i);
  return out;
}
