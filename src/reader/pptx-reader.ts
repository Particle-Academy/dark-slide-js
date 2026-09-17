/**
 * Best-effort PPTX → Deck reader. Faithful 1:1 port of PHP
 * `DarkSlide\Reader\PptxReader`. Uses the vendored zip + XML parser instead of
 * ZipArchive / SimpleXML.
 *
 * **read() is a pure function of its bytes.** The same package read twice — in
 * the same second or a year apart, here or on another machine — comes back as
 * an identical structure, down to every generated id. That is a contract
 * rather than a property of the current code: consumers store reads and diff
 * them, and one clock- or RNG-derived field turns a diff of unchanged content
 * into a whole-deck replace. Nothing here may put `Date.now()`, `Math.random()`
 * or the environment into a value it returns.
 *
 * **That diff is YOURS, not this package's.** `Differ`, `Reducer` and the
 * `DeckOp` vocabulary exist only in the PHP package — there is no diff surface
 * here, and nothing in this repo guards the property described above on your
 * behalf. This docblock used to describe the failure without saying where the
 * differ lived, which reads as a promise that something upstream handles it.
 * It does not. What this package owes you is a pure `read()`; comparing two
 * reads is your code, and the guard worth copying is "does the diff mention the
 * part that did not change?" — threshold-free, because a whole-deck replace
 * satisfies every bound (it is one operation, and smaller than the .pptx).
 *
 * **The id is a function of the CONTENT, never of the package bytes.** That
 * distinction took three attempts to state correctly, so it is worth being
 * blunt about: a digest of the bytes identifies a SERIALISATION, and two
 * serialisations of one deck are not byte-equal. 0.8.1 hashed the whole
 * package, which followed the writer's clock. 0.8.2 excluded the clock-bearing
 * part, which removed ONE source of byte variance and left the rest — a deck
 * carrying a shape or a code block still re-serialises to different
 * `ppt/slides/slideN.xml` bytes, so the id still moved while the structure sat
 * perfectly still. `contentDigest()` hashes what this method RETURNS.
 *
 * The consequence to hold on to: **any two byte layouts that read to the same
 * structure get the same id.** It does NOT follow that a file from another
 * producer and a DarkSlide-authored file of "the same deck" agree — that holds
 * only as far as `read()` normalises them to the same structure, which is not
 * promised here and is not what this guarantees.
 */

import { Emu } from "../helpers/emu";
import { parseXml, el, at, type XmlNode } from "./xml";
import { crc32, unzipSync } from "../zip";

const DECODER = new TextDecoder();
const ENCODER = new TextEncoder();

/** Reused across canonicalize() calls; `feed` consumes synchronously, so sharing is safe. */
const NUMBER_BYTES = new Uint8Array(8);
const NUMBER_VIEW = new DataView(NUMBER_BYTES.buffer);

/**
 * Feed one value to the digest in a form all three engines agree on.
 *
 * This is a CANONICAL ENCODING and its rules are the contract, not an
 * implementation detail — the PHP and Python engines implement the same one and
 * the reader-parity suites compare the resulting id, so a divergence here is a
 * divergence in the id. Spelled out:
 *
 *   null          `~`
 *   true / false  `T` / `F`
 *   number        `#` then the eight bytes of the IEEE-754 binary64, big endian
 *   string        `s`, the UTF-8 BYTE length in decimal, `:`, then the bytes
 *   empty [] / {} `e`
 *   array         `[` then each item, then `]`
 *   object        `{` then each key then its value, keys ascending, then `}`
 *
 * Three of those choices are load-bearing:
 *
 * **Numbers go in as raw IEEE bits, never as text.** The three languages
 * disagree about the TYPE of a number — PHP's `int / int` is an int when it
 * divides exactly, Python's `/` is always a float, JS has only doubles — and
 * about how a float RENDERS: PHP's depends on the `serialize_precision` ini
 * setting, which a consumer can change underneath us. Bit patterns have no such
 * freedom. Two finite doubles that compare equal have identical bits, and both
 * parity suites already assert the engines read numerically equal values, so
 * agreement here follows from a property that is already tested. `-0` is the one
 * exception to that and is normalised; non-finite values cannot occur in a deck
 * and are mapped to a marker rather than trusted.
 *
 * **Strings are length-prefixed**, so there is no escaping convention for three
 * languages to agree on.
 *
 * **An empty array and an empty object collapse to ONE marker.** PHP cannot tell
 * them apart — `[]` is both — so a table row with no cells is `[]` there and
 * `{}` here. Both parity suites already normalise the two together, which is the
 * estate deciding that distinction is not meaningful; a digest depending on it
 * would depend on something already ruled meaningless.
 *
 * Keys are sorted rather than taken in insertion order. JS's default sort is
 * UTF-16 code-unit order, which matches PHP's byte order and Python's code-point
 * order for everything below U+10000. Every key a read deck contains is
 * machine-generated ASCII, which the purity suite checks rather than assumes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function canonicalize(value: any, feed: (bytes: Uint8Array) => void): void {
  if (value === null || value === undefined) {
    feed(ENCODER.encode("~"));
    return;
  }
  if (typeof value === "boolean") {
    feed(ENCODER.encode(value ? "T" : "F"));
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      feed(ENCODER.encode("?"));
      return;
    }
    // `-0 === 0` is true, so this collapses negative zero, whose bits differ.
    NUMBER_VIEW.setFloat64(0, value === 0 ? 0 : value, false);
    feed(ENCODER.encode("#"));
    feed(NUMBER_BYTES);
    return;
  }
  if (typeof value === "string") {
    const bytes = ENCODER.encode(value);
    feed(ENCODER.encode("s" + bytes.length + ":"));
    feed(bytes);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      feed(ENCODER.encode("e"));
      return;
    }
    feed(ENCODER.encode("["));
    for (const item of value) canonicalize(item, feed);
    feed(ENCODER.encode("]"));
    return;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    if (keys.length === 0) {
      feed(ENCODER.encode("e"));
      return;
    }
    feed(ENCODER.encode("{"));
    for (const key of keys) {
      canonicalize(key, feed);
      canonicalize((value as Record<string, unknown>)[key], feed);
    }
    feed(ENCODER.encode("}"));
    return;
  }

  // Unreachable for a deck, which is arrays, objects and scalars all the way down.
  feed(ENCODER.encode("?"));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function base64Encode(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  // eslint-disable-next-line no-undef
  return btoa(bin);
}

/** PHP basename of a path. */
function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1]!;
}

/** PHP dirname of a path. */
function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx < 0 ? "." : path.slice(0, idx);
}

/** Lowercased file extension (no dot). */
function extension(path: string): string {
  const base = basename(path);
  const idx = base.lastIndexOf(".");
  return idx < 0 ? "" : base.slice(idx + 1).toLowerCase();
}

/** First descendant (self excluded) with the given local name, depth-first. */
function descendant(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) return undefined;
  for (const child of node.children) {
    if (child.name === name) return child;
    const found = descendant(child, name);
    if (found) return found;
  }
  return undefined;
}

/** All descendants (self excluded) with the given local name, document order. */
function descendants(node: XmlNode | undefined, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  if (!node) return out;
  for (const child of node.children) {
    if (child.name === name) out.push(child);
    out.push(...descendants(child, name));
  }
  return out;
}

/** Concatenated text of a node and all descendants. */
function deepText(node: XmlNode): string {
  let s = node.text;
  for (const child of node.children) s += deepText(child);
  return s;
}

export class PptxReader {
  private currentSlideRels: Record<string, { type: string; target: string }> = {};

  /**
   * The mono typeface this deck was written with, read back from the theme's
   * `<a:extLst>`. Empty when the package does not record one — anything not
   * written by a current DarkSlide — in which case the name sniff below is the
   * only signal available.
   */
  private monoTypeface = "";
  private parts: Record<string, Uint8Array> = {};

  /**
   * The slide size from `<p:sldSz>`, so geometry comes back as fractions of THIS
   * slide. Every conversion used to assume 16:9 at 10in, which read a 4:3 deck's
   * positions back wrong.
   */
  private slideWidthEmu = Emu.DEFAULT_SLIDE_WIDTH;
  private slideHeightEmu = Emu.DEFAULT_SLIDE_HEIGHT;

  /**
   * The 1-based number of the slide being parsed, and how many fallback ids
   * have been minted for it. Together they replace a `Math.random()` fallback
   * for elements whose `<p:cNvPr>` carries no `name`. Numbering PER SLIDE is
   * deliberate: inserting one shape into slide 1 then shifts only slide 1's ids
   * instead of renumbering every element after it, which would turn a
   * one-element edit into a whole-deck diff — the same failure the clock id
   * caused, reached by an edit rather than by time.
   */
  private slideNumber = 0;
  private slideFallbackIds = 0;

  /**
   * An id for an element whose `<p:cNvPr>` carries no `name` to borrow one
   * from: its position in the file, as `imported-<slide>-<nth>`. Callers reach
   * it through `??`, which does not evaluate it unless the name is genuinely
   * absent, so the numbering stays tied to the file rather than to how many
   * elements were parsed.
   */
  private nextFallbackId(prefix = "imported-"): string {
    this.slideFallbackIds++;

    return prefix + this.slideNumber + "-" + this.slideFallbackIds;
  }

  /** Read a PPTX file's bytes into a Deck schema object. */
  read(bytes: Uint8Array): Record<string, unknown> {
    return this.fromBytes(bytes);
  }

  fromBytes(bytes: Uint8Array): Record<string, unknown> {
    // Everything this read returns is derived from these bytes, here or below.
    // The counters start over on every call because one reader instance may be
    // handed a second file.
    this.slideNumber = 0;
    this.slideFallbackIds = 0;

    this.parts = unzipSync(bytes);
    const deck = this.extract();
    // Stamped HERE rather than inside extract() because extract() has early
    // returns for a malformed package, and an id that some return paths skip is
    // worse than one that is wrong.
    deck.id = "imported-" + this.contentDigest(deck);
    return deck;
  }

  /**
   * The deck id: CRC-32 over a canonical encoding of the DECK, as eight
   * lowercase hex digits. Not of the package — see the note on this class.
   *
   * `id` is removed first, because it is the value being computed. Nothing else
   * is removed: every other field is either read out of the file or derived
   * deterministically from it (`imported-slide-N`, and an element's positional
   * fallback id), so all of it is content.
   */
  private contentDigest(deck: Record<string, unknown>): string {
    const content: Record<string, unknown> = { ...deck };
    delete content.id;

    let crc = 0;
    canonicalize(content, (chunk) => {
      crc = crc32(chunk, crc);
    });

    return crc.toString(16).padStart(8, "0");
  }

  /**
   * The mono typeface recorded in `theme1.xml`'s `<a:extLst>`, or `""`.
   *
   * Deliberately a regex rather than a parse: this runs before the deck is
   * built, the element is one attribute deep, and a theme part that does not
   * carry the extension is the common case rather than an error.
   */
  private readMonoTypeface(): string {
    const xml = this.getPart("ppt/theme/theme1.xml");
    if (xml === false) {
      return "";
    }

    const m = /<ds:monoFont[^>]*typeface="([^"]*)"/.exec(xml);
    return m
      ? m[1]!
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
      : "";
  }

  private getPart(name: string): string | false {
    const p = this.parts[name];
    return p === undefined ? false : DECODER.decode(p);
  }

  private extract(): Record<string, unknown> {
    const deck: Record<string, Any> = {
      // Filled in by fromBytes() once the deck is complete — the digest is over
      // the content, so it cannot exist before the content does. Declared first
      // so the returned key order is unchanged.
      id: "",
      title: this.readCoreTitle() ?? "Imported",
      theme: { name: "imported" },
      slides: [],
    };

    this.monoTypeface = this.readMonoTypeface();
    this.readSlideSize();
    // 16:9 at 10in is the default and says nothing; any other shape is part of
    // the deck and comes back as its aspect ratio.
    if (this.slideWidthEmu !== Emu.DEFAULT_SLIDE_WIDTH || this.slideHeightEmu !== Emu.DEFAULT_SLIDE_HEIGHT) {
      // A JS number is always a double. PHP casts explicitly, because its
      // `int / int` is an int when it divides exactly (a 2:1 slide read back as 2).
      deck.theme.aspectRatio = this.slideWidthEmu / this.slideHeightEmu;
    }

    const presentationRels = this.getPart("ppt/_rels/presentation.xml.rels");
    if (presentationRels === false) {
      return deck;
    }
    const slideTargets = this.extractSlideTargets(presentationRels);

    slideTargets.forEach((slideTarget, i) => {
      const slideXml = this.getPart("ppt/" + slideTarget);
      if (slideXml === false) {
        return;
      }
      const slideRels =
        this.getPart("ppt/" + dirname(slideTarget) + "/_rels/" + basename(slideTarget) + ".rels") || "";
      const notes = this.readNotesFor(slideRels);
      this.currentSlideRels = this.parseSlideRels(slideRels, slideTarget);
      this.slideNumber = i + 1;
      this.slideFallbackIds = 0;

      const slide = this.parseSlide(slideXml, "imported-slide-" + (i + 1), notes);
      deck.slides.push(slide);
    });

    // Only when the file embeds any, so every other read is unchanged.
    const embeddedFonts = this.readEmbeddedFonts();
    if (embeddedFonts.length > 0) {
      deck.metadata = { embeddedFonts };
    }

    return deck;
  }

  private readSlideSize(): void {
    this.slideWidthEmu = Emu.DEFAULT_SLIDE_WIDTH;
    this.slideHeightEmu = Emu.DEFAULT_SLIDE_HEIGHT;

    const xml = this.getPart("ppt/presentation.xml");
    if (xml === false) return;
    const tag = /<p:sldSz\b[^>]*>/.exec(xml);
    if (!tag) return;

    const cx = /\bcx="(\d+)"/.exec(tag[0]);
    if (cx && parseInt(cx[1]!, 10) > 0) this.slideWidthEmu = parseInt(cx[1]!, 10);
    const cy = /\bcy="(\d+)"/.exec(tag[0]);
    if (cy && parseInt(cy[1]!, 10) > 0) this.slideHeightEmu = parseInt(cy[1]!, 10);
  }

  private fracX(emu: number): number {
    return Emu.toFracX(emu, this.slideWidthEmu);
  }

  private fracY(emu: number): number {
    return Emu.toFracY(emu, this.slideHeightEmu);
  }

  /**
   * The typefaces the file embeds and which of the four variants each carries.
   *
   * Names and variants only, never the font bytes: a reader's output is a deck,
   * and a deck is agent-facing JSON that has no business holding licensed
   * binaries.
   */
  private readEmbeddedFonts(): { typeface: string; variants: string[] }[] {
    const xml = this.getPart("ppt/presentation.xml");
    if (xml === false) return [];
    const list = /<p:embeddedFontLst>([\s\S]*?)<\/p:embeddedFontLst>/.exec(xml);
    if (!list) return [];

    const fonts: { typeface: string; variants: string[] }[] = [];
    for (const entry of list[1]!.matchAll(/<p:embeddedFont>([\s\S]*?)<\/p:embeddedFont>/g)) {
      const face = /<p:font\b[^>]*\btypeface="([^"]*)"/.exec(entry[1]!);
      if (!face) continue;
      const variants = [...entry[1]!.matchAll(/<p:(regular|bold|italic|boldItalic)\b/g)].map((m) => m[1]!);
      fonts.push({ typeface: decodeXmlAttr(face[1]!), variants });
    }

    return fonts;
  }

  private parseSlideRels(relsXml: string, slideTargetRelative: string): Record<string, { type: string; target: string }> {
    if (relsXml === "") {
      return {};
    }
    const root = parseXml(relsXml);
    if (!root) {
      return {};
    }

    const slideDirAbs = "ppt/" + dirname(slideTargetRelative);
    const rels: Record<string, { type: string; target: string }> = {};
    for (const r of descendants(root, "Relationship")) {
      const id = at(r, "Id") ?? "";
      const type = at(r, "Type") ?? "";
      const target = at(r, "Target") ?? "";
      const resolved = this.resolveRelTarget(slideDirAbs, target);
      rels[id] = { type, target: resolved };
    }

    return rels;
  }

  private resolveRelTarget(baseDir: string, target: string): string {
    if (target.startsWith("/")) {
      return target.replace(/^\/+/, "");
    }
    const stack = baseDir.split("/");
    for (const segment of target.split("/")) {
      if (segment === "..") {
        stack.pop();
      } else if (segment !== "." && segment !== "") {
        stack.push(segment);
      }
    }
    return stack.join("/");
  }

  private extractSlideTargets(relsXml: string): string[] {
    const targets: string[] = [];
    const root = parseXml(relsXml);
    if (!root) {
      return [];
    }
    for (const r of descendants(root, "Relationship")) {
      const type = at(r, "Type") ?? "";
      if (type.endsWith("/slide")) {
        targets.push(at(r, "Target") ?? "");
      }
    }
    return targets;
  }

  private readCoreTitle(): string | null {
    const xml = this.getPart("docProps/core.xml");
    if (xml === false) {
      return null;
    }
    const root = parseXml(xml);
    if (!root) {
      return null;
    }
    const title = descendant(root, "title");
    if (title) {
      return deepText(title);
    }
    return null;
  }

  private readNotesFor(slideRelsXml: string): string | null {
    if (slideRelsXml === "") {
      return null;
    }
    const root = parseXml(slideRelsXml);
    if (!root) {
      return null;
    }
    for (const r of descendants(root, "Relationship")) {
      if ((at(r, "Type") ?? "").endsWith("/notesSlide")) {
        const target = at(r, "Target") ?? "";
        const notesXml = this.getPart("ppt/" + target.replace(/\.\.\//g, "").replace(/^\/+/, ""));
        if (notesXml === false) {
          return null;
        }
        return this.parseNotesText(notesXml);
      }
    }
    return null;
  }

  private parseNotesText(xml: string): string {
    const root = parseXml(xml);
    if (!root) {
      return "";
    }
    const parts: string[] = [];
    for (const t of descendants(root, "t")) {
      parts.push(deepText(t));
    }
    return parts.join("\n");
  }

  private parseSlide(xml: string, id: string, notes: string | null): Record<string, Any> {
    const slide: Record<string, Any> = {
      id,
      layout: "blank",
      elements: [],
    };
    if (notes !== null && notes !== "") {
      slide.notes = notes;
    }

    const root = parseXml(xml);
    if (!root) {
      return slide;
    }

    const bg = this.parseBackground(root);
    if (bg !== null) {
      slide.background = bg;
    }

    for (const shape of descendants(root, "sp")) {
      const element = this.parseShape(shape);
      if (element !== null) {
        slide.elements.push(element);
      }
    }
    for (const pic of descendants(root, "pic")) {
      const element = this.parsePic(pic);
      if (element !== null) {
        slide.elements.push(element);
      }
    }
    for (const gf of descendants(root, "graphicFrame")) {
      const element = this.parseGraphicFrame(gf);
      if (element !== null) {
        slide.elements.push(element);
      }
    }

    return slide;
  }

  private parseBackground(root: XmlNode): Record<string, Any> | null {
    // //p:bg/p:bgPr → first bgPr that is a child of a bg.
    let bgPr: XmlNode | undefined;
    for (const bg of descendants(root, "bg")) {
      const inner = el(bg, "bgPr");
      if (inner) {
        bgPr = inner;
        break;
      }
    }
    if (!bgPr) {
      return null;
    }

    // Solid fill
    const solidFill = descendant(bgPr, "solidFill");
    const solid = solidFill ? descendant(solidFill, "srgbClr") : undefined;
    if (solid) {
      const hex = at(solid, "val") ?? "";
      if (hex !== "") {
        return { color: "#" + hex };
      }
    }

    // Gradient fill
    const grad = descendant(bgPr, "gradFill");
    if (grad) {
      const css = this.gradFillToCss(grad);
      if (css !== null) {
        return { gradient: css };
      }
    }

    // Image (blipFill)
    const blipFill = descendant(bgPr, "blipFill");
    const blip = blipFill ? descendant(blipFill, "blip") : undefined;
    if (blip) {
      const rid = at(blip, "embed") ?? "";
      if (rid !== "" && this.currentSlideRels[rid] !== undefined) {
        const dataUri = this.readMediaAsDataUri(this.currentSlideRels[rid]!.target);
        if (dataUri !== null) {
          return { image: dataUri };
        }
      }
    }

    return null;
  }

  private gradFillToCss(grad: XmlNode): string | null {
    const stops = descendants(grad, "gs");
    if (stops.length === 0) {
      return null;
    }

    const stopStrings: string[] = [];
    for (const stop of stops) {
      const pos = parseInt(at(stop, "pos") ?? "0", 10) || 0; // 0..100000
      const pct = round1(pos / 1000);
      const color = descendant(stop, "srgbClr");
      if (!color) {
        continue;
      }
      const hex = at(color, "val") ?? "";
      if (hex === "") {
        continue;
      }
      stopStrings.push("#" + hex.toLowerCase() + " " + numToStr(pct) + "%");
    }
    if (stopStrings.length === 0) {
      return null;
    }

    const lin = descendant(grad, "lin");
    let angle = 180;
    if (lin) {
      const pptxAng = parseInt(at(lin, "ang") ?? "0", 10) || 0;
      const deg = pptxAng / 60000 + 90;
      angle = Math.round((((deg % 360) + 360) % 360));
    }

    return "linear-gradient(" + angle + "deg, " + stopStrings.join(", ") + ")";
  }

  private readMediaAsDataUri(archivePath: string): string | null {
    const part = this.parts[archivePath];
    if (part === undefined) {
      return null;
    }
    const mime = this.guessMimeFromArchivePath(archivePath);
    return "data:" + mime + ";base64," + base64Encode(part);
  }

  private guessMimeFromArchivePath(path: string): string {
    switch (extension(path)) {
      case "png":
        return "image/png";
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "gif":
        return "image/gif";
      case "svg":
        return "image/svg+xml";
      case "webp":
        return "image/webp";
      default:
        return "application/octet-stream";
    }
  }

  private parseShape(sp: XmlNode): Record<string, Any> | null {
    const xfrm = descendant(sp, "xfrm");
    if (!xfrm) {
      return null;
    }
    const offset = el(xfrm, "off");
    const extent = el(xfrm, "ext");
    if (!offset || !extent) {
      return null;
    }
    const x = parseInt(at(offset, "x") ?? "0", 10) || 0;
    const y = parseInt(at(offset, "y") ?? "0", 10) || 0;
    const cx = parseInt(at(extent, "cx") ?? "0", 10) || 0;
    const cy = parseInt(at(extent, "cy") ?? "0", 10) || 0;

    const cNvPr = descendant(sp, "cNvPr");
    const base: Record<string, Any> = {
      id: (cNvPr ? at(cNvPr, "name") : undefined) ?? this.nextFallbackId(),
      x: this.fracX(x),
      y: this.fracY(y),
      w: this.fracX(cx),
      h: this.fracY(cy),
    };

    const tBody = descendant(sp, "txBody");
    const paragraphMarkdown: string[] = [];
    let anyDecoration = false;
    if (tBody) {
      for (const p of descendants(tBody, "p")) {
        const [md, decorated] = this.paragraphToMarkdown(p);
        paragraphMarkdown.push(md);
        anyDecoration = anyDecoration || decorated;
      }
    }

    const prstGeom = descendant(sp, "prstGeom");
    const prst = prstGeom ? at(prstGeom, "prst") ?? null : null;

    const hasText = paragraphMarkdown.some((t) => t !== "");
    if (hasText) {
      return {
        ...base,
        type: "text",
        content: paragraphMarkdown.join("\n"),
        format: anyDecoration ? "markdown" : "plain",
      };
    }

    let shapeKind: string | null;
    switch (prst) {
      case "rect":
        shapeKind = "rect";
        break;
      case "roundRect":
        shapeKind = "rounded-rect";
        break;
      case "ellipse":
        shapeKind = "ellipse";
        break;
      case "triangle":
        shapeKind = "triangle";
        break;
      case "line":
        shapeKind = "line";
        break;
      case "rightArrow":
        shapeKind = "arrow";
        break;
      default:
        shapeKind = null;
    }
    if (shapeKind !== null) {
      return { ...base, type: "shape", shape: shapeKind };
    }

    return null;
  }

  private parsePic(pic: XmlNode): Record<string, Any> | null {
    const xfrm = descendant(pic, "xfrm");
    if (!xfrm) {
      return null;
    }
    const offset = el(xfrm, "off");
    const extent = el(xfrm, "ext");
    if (!offset || !extent) {
      return null;
    }

    let src = "";
    const blip = descendant(pic, "blip");
    if (blip) {
      const rid = at(blip, "embed") ?? "";
      if (rid !== "" && this.currentSlideRels[rid] !== undefined) {
        const dataUri = this.readMediaAsDataUri(this.currentSlideRels[rid]!.target);
        if (dataUri !== null) {
          src = dataUri;
        }
      }
    }

    const cNvPr = descendant(pic, "cNvPr");

    return {
      id: (cNvPr ? at(cNvPr, "name") : undefined) ?? this.nextFallbackId(),
      type: "image",
      x: this.fracX(parseInt(at(offset, "x") ?? "0", 10) || 0),
      y: this.fracY(parseInt(at(offset, "y") ?? "0", 10) || 0),
      w: this.fracX(parseInt(at(extent, "cx") ?? "0", 10) || 0),
      h: this.fracY(parseInt(at(extent, "cy") ?? "0", 10) || 0),
      src,
      fit: "contain",
    };
  }

  private parseGraphicFrame(gf: XmlNode): Record<string, Any> | null {
    const xfrm = descendant(gf, "xfrm");
    if (!xfrm) {
      return null;
    }
    const offset = el(xfrm, "off");
    const extent = el(xfrm, "ext");
    if (!offset || !extent) {
      return null;
    }

    const tbl = descendant(gf, "tbl");
    if (!tbl) {
      return null;
    }

    const rows = descendants(tbl, "tr");
    if (rows.length === 0) {
      return null;
    }

    // Whether row 0 is a header is DECLARED, not assumed. `a:tblPr/@firstRow`
    // is the only thing that says so, and header-less tables are ordinary now —
    // every metadataGrid and kpiBand is one. Assuming a header promoted a row
    // of DATA to column labels and dropped it from the rows, silently losing
    // content on the way back in.
    const tblPr = descendant(tbl, "tblPr");
    const hasHeader = tblPr !== undefined && (at(tblPr, "firstRow") ?? "0") === "1";

    // Column widths come from the grid, as fractions of the table, so a table
    // written with unequal columns reads back with them.
    const gridWidths = descendants(tbl, "gridCol").map((c) => parseInt(at(c, "w") ?? "0", 10) || 0);
    const gridTotal = gridWidths.reduce((a, b) => a + b, 0);

    const firstCells = descendants(rows[0]!, "tc");
    const columnCount = Math.max(firstCells.length, gridWidths.length);

    const columns: { key: string; label: string; width?: number }[] = [];
    for (let i = 0; i < columnCount; i++) {
      const column: { key: string; label: string; width?: number } = {
        key: "col" + (i + 1),
        label: hasHeader && firstCells[i] !== undefined ? this.cellText(firstCells[i]!) : "",
      };
      if (gridTotal > 0 && gridWidths[i] !== undefined) {
        column.width = gridWidths[i]! / gridTotal;
      }
      columns.push(column);
    }

    const bodyRows: Record<string, string>[] = [];
    for (let r = hasHeader ? 1 : 0; r < rows.length; r++) {
      const rowCells = descendants(rows[r]!, "tc");
      const rowData: Record<string, string> = {};
      columns.forEach((col, i) => {
        const cell = rowCells[i];
        if (cell !== undefined) {
          rowData[col.key] = this.cellText(cell);
        }
      });
      bodyRows.push(rowData);
    }

    const cNvPr = descendant(gf, "cNvPr");

    return {
      id: (cNvPr ? at(cNvPr, "name") : undefined) ?? this.nextFallbackId("imported-table-"),
      type: "table",
      x: this.fracX(parseInt(at(offset, "x") ?? "0", 10) || 0),
      y: this.fracY(parseInt(at(offset, "y") ?? "0", 10) || 0),
      w: this.fracX(parseInt(at(extent, "cx") ?? "0", 10) || 0),
      h: this.fracY(parseInt(at(extent, "cy") ?? "0", 10) || 0),
      columns,
      rows: bodyRows,
    };
  }

  private cellText(cell: XmlNode): string {
    const segments: string[] = [];
    for (const t of descendants(cell, "t")) {
      segments.push(deepText(t));
    }
    return segments.join("");
  }

  private paragraphToMarkdown(p: XmlNode): [string, boolean] {
    // Bullet?
    const pPr = descendant(p, "pPr");
    const bu = pPr ? descendant(pPr, "buChar") : undefined;
    const isBullet = bu !== undefined;

    const runs = descendants(p, "r");
    if (runs.length === 0) {
      return [isBullet ? "- " : "", isBullet];
    }

    let parsed: { text: string; b: boolean; i: boolean; code: boolean }[] = [];
    let allBold = true;
    let allItalic = true;
    let anyNonEmpty = false;
    for (const r of runs) {
      const rPr = el(r, "rPr");
      const tNode = el(r, "t");
      const text = tNode ? deepText(tNode) : "";
      let b = false;
      let i = false;
      let code = false;
      if (rPr) {
        b = (at(rPr, "b") ?? "0") === "1";
        i = (at(rPr, "i") ?? "0") === "1";
        const latin = el(rPr, "latin");
        if (latin) {
          const typeface = (at(latin, "typeface") ?? "").toLowerCase();
          // Exact match against the typeface the deck RECORDED first, then the
          // name sniff.
          //
          // The sniff alone was sound while the writer always emitted Consolas.
          // Once a deck can name its own mono font it is not: "Fira Code" and
          // "Cascadia" contain none of these words, so a code run came back as
          // plain text — a silent downgrade on a file that opens perfectly.
          //
          // The sniff stays as the fallback, because it is the only thing that
          // works for a pptx written by anything else.
          const recorded = this.monoTypeface.toLowerCase();

          if (
            (recorded !== "" && typeface === recorded) ||
            typeface.includes("consola") ||
            typeface.includes("mono") ||
            typeface.includes("courier")
          ) {
            code = true;
          }
        }
      }
      if (text !== "") {
        anyNonEmpty = true;
        if (!b) {
          allBold = false;
        }
        if (!i) {
          allItalic = false;
        }
      }
      parsed.push({ text, b, i, code });
    }
    if (!anyNonEmpty) {
      return [isBullet ? "- " : "", isBullet];
    }

    // Coalesce adjacent runs that carry the SAME decoration.
    //
    // DrawingML splits text into runs for reasons that have nothing to do with
    // emphasis — a syntax highlighter emits one run per token, all of them
    // code — and emitting a marker per run produces markdown that is not merely
    // ugly but WRONG. A highlighted `const deck = 1;` came back as
    // "`const`` deck = ``1``;`", where every pair of adjacent backticks closes
    // one span and opens the next, so re-parsing it yields the inverse of the
    // intended emphasis.
    //
    // Merging first is also what makes the output stable: the same text reads
    // the same whether the writer split it into one run or six.
    const merged: typeof parsed = [];
    for (const run of parsed) {
      const last = merged[merged.length - 1];

      if (last && last.b === run.b && last.i === run.i && last.code === run.code) {
        last.text += run.text;
        continue;
      }

      merged.push({ ...run });
    }
    parsed = merged;

    let line = "";
    let anyDecoration = false;
    for (const run of parsed) {
      const text = run.text;
      const emitBold = run.b && !allBold;
      const emitItalic = run.i && !allItalic;
      if (run.code) {
        line += "`" + text + "`";
        anyDecoration = true;
      } else if (emitBold && emitItalic) {
        line += "***" + text + "***";
        anyDecoration = true;
      } else if (emitBold) {
        line += "**" + text + "**";
        anyDecoration = true;
      } else if (emitItalic) {
        line += "*" + text + "*";
        anyDecoration = true;
      } else {
        line += text;
      }
    }

    if (isBullet) {
      return ["- " + line, true];
    }

    return [line, anyDecoration];
  }
}

// ─── Module helpers ──────────────────────────────────────────────────────

/** PHP `round($x, 1)`. */
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** PHP `(string)` of a float — JS `String` already drops trailing `.0`. */
function numToStr(n: number): string {
  return String(n);
}

/** An attribute value's XML entities, as PHP's `html_entity_decode(..., ENT_QUOTES | ENT_XML1)` reads them. */
function decodeXmlAttr(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
