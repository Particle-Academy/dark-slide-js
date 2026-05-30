/**
 * Best-effort PPTX → Deck reader. Faithful 1:1 port of PHP
 * `DarkSlide\Reader\PptxReader`. Uses the vendored zip + XML parser instead of
 * ZipArchive / SimpleXML.
 */

import { Emu } from "../helpers/emu";
import { parseXml, el, at, type XmlNode } from "./xml";
import { unzipSync } from "../zip";

const DECODER = new TextDecoder();

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
  private parts: Record<string, Uint8Array> = {};

  /** Read a PPTX file's bytes into a Deck schema object. */
  read(bytes: Uint8Array): Record<string, unknown> {
    return this.fromBytes(bytes);
  }

  fromBytes(bytes: Uint8Array): Record<string, unknown> {
    this.parts = unzipSync(bytes);
    return this.extract();
  }

  private getPart(name: string): string | false {
    const p = this.parts[name];
    return p === undefined ? false : DECODER.decode(p);
  }

  private extract(): Record<string, unknown> {
    const deck: Record<string, Any> = {
      id: "imported-" + ((Math.floor(Date.now() / 1000) & 0xffffff).toString(16)),
      title: this.readCoreTitle() ?? "Imported",
      theme: { name: "imported" },
      slides: [],
    };

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

      const slide = this.parseSlide(slideXml, "imported-slide-" + (i + 1), notes);
      deck.slides.push(slide);
    });

    return deck;
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
      id: cNvPr ? at(cNvPr, "name") ?? "imported-" + randInt(1000, 9999) : "imported-" + randInt(1000, 9999),
      x: Emu.toFracX(x),
      y: Emu.toFracY(y),
      w: Emu.toFracX(cx),
      h: Emu.toFracY(cy),
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
      id: cNvPr ? at(cNvPr, "name") ?? "imported-" + randInt(1000, 9999) : "imported-" + randInt(1000, 9999),
      type: "image",
      x: Emu.toFracX(parseInt(at(offset, "x") ?? "0", 10) || 0),
      y: Emu.toFracY(parseInt(at(offset, "y") ?? "0", 10) || 0),
      w: Emu.toFracX(parseInt(at(extent, "cx") ?? "0", 10) || 0),
      h: Emu.toFracY(parseInt(at(extent, "cy") ?? "0", 10) || 0),
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

    const headerCells = descendants(rows[0]!, "tc");
    const columns: { key: string; label: string }[] = [];
    headerCells.forEach((cell, i) => {
      const label = this.cellText(cell);
      columns.push({ key: "col" + (i + 1), label });
    });

    const bodyRows: Record<string, string>[] = [];
    for (let r = 1; r < rows.length; r++) {
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
      id: cNvPr ? at(cNvPr, "name") ?? "imported-table-" + randInt(1000, 9999) : "imported-table-" + randInt(1000, 9999),
      type: "table",
      x: Emu.toFracX(parseInt(at(offset, "x") ?? "0", 10) || 0),
      y: Emu.toFracY(parseInt(at(offset, "y") ?? "0", 10) || 0),
      w: Emu.toFracX(parseInt(at(extent, "cx") ?? "0", 10) || 0),
      h: Emu.toFracY(parseInt(at(extent, "cy") ?? "0", 10) || 0),
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

    const parsed: { text: string; b: boolean; i: boolean; code: boolean }[] = [];
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
          if (typeface.includes("consola") || typeface.includes("mono") || typeface.includes("courier")) {
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

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** PHP `round($x, 1)`. */
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** PHP `(string)` of a float — JS `String` already drops trailing `.0`. */
function numToStr(n: number): string {
  return String(n);
}
