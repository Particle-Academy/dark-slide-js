/**
 * PPTX (Office Open XML) writer. Faithful 1:1 port of PHP
 * `DarkSlide\Writer\PptxWriter`. Builds the archive entirely in memory and
 * returns its bytes via the vendored `zipSync`. Every emitted string mirrors
 * the PHP writer byte-for-byte.
 */

import { ChartTranslator, type ChartSpec } from "../helpers/chart-translator";
import { Color } from "../helpers/color";
import { Emu } from "../helpers/emu";
import { MarkdownInline } from "../helpers/markdown-inline";
import { SyntaxHighlighter } from "../helpers/syntax-highlighter";
import { Xml } from "../helpers/xml";
import { Schema } from "../schema/schema";
import { isNumeric, isPlainObject } from "../util";
import { zipSync } from "../zip";

const NS_CHART = "http://schemas.openxmlformats.org/drawingml/2006/chart";

const LAYOUT_ORDER = [
  "blank",
  "title",
  "title-content",
  "two-column",
  "section-divider",
  "image-text",
  "text-image",
  "quote",
];

const CHART_PALETTE = ["8B5CF6", "EC4899", "06B6D4", "F59E0B", "10B981", "3B82F6", "EF4444", "A855F7"];

const ENCODER = new TextEncoder();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

interface Rel {
  id: string;
  type: string;
  target: string;
  mode?: string;
}

interface MediaData {
  bytes: Uint8Array;
  mime: string;
}

interface StagedMedia {
  relId: string;
  target: string;
  bytes: Uint8Array;
}

interface AnimatedBuild {
  shapeId: number;
  arrayIndex: number;
  animation: Record<string, Any>;
  paragraphCount: number | null;
}

interface SubBuild {
  shapeId: number;
  arrayIndex: number;
  animation: Record<string, Any>;
  paragraph: number | null;
}

function base64Decode(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(b64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  // eslint-disable-next-line no-undef
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** PHP `(int)` truncation toward zero. */
function toInt(v: Any): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

export class PptxWriter {
  private mediaCounter = 0;
  private chartCounter = 0;
  /** Ordered list of media files queued for the archive. */
  private mediaFiles: { path: string; bytes: Uint8Array }[] = [];
  /** Ordered list of chart part XML queued for the archive. */
  private chartFiles: { path: string; xml: string }[] = [];
  private themeAccent = "8B5CF6";
  private tnId = 0;
  private pendingSlideRels: Record<number, Rel[]> = {};

  constructor(
    private tempDir: string | null = null,
    private allowHttpImages = false,
  ) {}

  write(): never {
    throw new Error("PptxWriter.write is Node-only; use Agent.write");
  }

  toBytes(deck: Any): Uint8Array {
    this.mediaCounter = 0;
    this.chartCounter = 0;
    this.mediaFiles = [];
    this.chartFiles = [];
    this.pendingSlideRels = {};
    [this.themeAccent] = Color.parse((deck?.theme?.colors?.accent ?? "#8B5CF6") as string, "8B5CF6");

    const slides: Any[] = deck?.slides ?? [];
    const slideCount = slides.length;

    const files: { name: string; data: Uint8Array }[] = [];
    const add = (name: string, content: string | Uint8Array) => {
      files.push({ name, data: typeof content === "string" ? ENCODER.encode(content) : content });
    };

    // 1. Stage every text-based part first so media/chart references register
    //    before [Content_Types].xml is written.
    const slidesXml: Record<number, string> = {};
    const notesSlidesXml: Record<number, string> = {};
    slides.forEach((slide, i) => {
      const oneBased = i + 1;
      slidesXml[oneBased] = this.buildSlideXml(slide, oneBased, deck);
      if (slide && slide.notes) {
        notesSlidesXml[oneBased] = this.buildNotesSlideXml(slide, oneBased);
      }
    });

    const notesIds = Object.keys(notesSlidesXml).map((k) => parseInt(k, 10));
    const chartPartPaths = this.chartFiles.map((c) => c.path);

    // 2. Top-level + ppt-level scaffolding.
    add("[Content_Types].xml", this.buildContentTypes(slideCount, notesIds, chartPartPaths));
    add("_rels/.rels", this.buildTopRels());
    add("docProps/core.xml", this.buildCoreProps(deck));
    add("docProps/app.xml", this.buildAppProps(slideCount));

    add("ppt/presentation.xml", this.buildPresentation(slideCount));
    add("ppt/_rels/presentation.xml.rels", this.buildPresentationRels(slideCount));

    add("ppt/theme/theme1.xml", this.buildTheme(deck));
    add("ppt/slideMasters/slideMaster1.xml", this.buildSlideMaster());
    add("ppt/slideMasters/_rels/slideMaster1.xml.rels", this.buildSlideMasterRels());

    // 3. Slide layout parts.
    LAYOUT_ORDER.forEach((layoutName, idx) => {
      const n = idx + 1;
      add(`ppt/slideLayouts/slideLayout${n}.xml`, this.buildSlideLayout(layoutName));
      add(`ppt/slideLayouts/_rels/slideLayout${n}.xml.rels`, this.buildSlideLayoutRels());
    });

    // 4. Slide parts.
    for (let i = 1; i <= slideCount; i++) {
      const xml = slidesXml[i]!;
      const layoutNum = this.layoutNumberFor(slides[i - 1]?.layout ?? null);
      add(`ppt/slides/slide${i}.xml`, xml);
      add(`ppt/slides/_rels/slide${i}.xml.rels`, this.buildSlideRels(i, notesSlidesXml[i] !== undefined, layoutNum));
    }

    // 5. Notes slide parts.
    for (const i of notesIds) {
      add(`ppt/notesSlides/notesSlide${i}.xml`, notesSlidesXml[i]!);
      add(`ppt/notesSlides/_rels/notesSlide${i}.xml.rels`, this.buildNotesSlideRels(i));
    }

    // 6. Native chart parts.
    for (const chart of this.chartFiles) {
      add(chart.path, chart.xml);
    }

    // 7. Embedded media files.
    for (const media of this.mediaFiles) {
      add(media.path, media.bytes);
    }

    return zipSync(files);
  }

  // ─── Top-level parts ───────────────────────────────────────────────────

  private buildContentTypes(slideCount: number, notesSlideIds: number[], chartParts: string[]): string {
    let slideOverrides = "";
    for (let i = 1; i <= slideCount; i++) {
      slideOverrides +=
        '<Override PartName="/ppt/slides/slide' +
        i +
        '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
    }
    let layoutOverrides = "";
    LAYOUT_ORDER.forEach((_, idx) => {
      const n = idx + 1;
      layoutOverrides +=
        '<Override PartName="/ppt/slideLayouts/slideLayout' +
        n +
        '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>';
    });
    let notesOverrides = "";
    for (const i of notesSlideIds) {
      notesOverrides +=
        '<Override PartName="/ppt/notesSlides/notesSlide' +
        i +
        '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>';
    }
    let chartOverrides = "";
    for (const archivePath of chartParts) {
      chartOverrides +=
        '<Override PartName="/' +
        archivePath +
        '" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>';
    }

    const extensionDefaults =
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Default Extension="jpg" ContentType="image/jpeg"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Default Extension="gif" ContentType="image/gif"/>' +
      '<Default Extension="svg" ContentType="image/svg+xml"/>' +
      '<Default Extension="webp" ContentType="image/webp"/>';

    return (
      Xml.declaration() +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      extensionDefaults +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      layoutOverrides +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      slideOverrides +
      notesOverrides +
      chartOverrides +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      "</Types>"
    );
  }

  private buildTopRels(): string {
    return (
      Xml.declaration() +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      "</Relationships>"
    );
  }

  private buildCoreProps(deck: Any): string {
    const title = Xml.text(String(deck?.title ?? "Untitled"));
    const author =
      deck?.metadata?.author !== undefined && deck?.metadata?.author !== null
        ? Xml.text(String(deck.metadata.author))
        : "Dark Slide";
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

    return (
      Xml.declaration() +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${title}</dc:title>` +
      `<dc:creator>${author}</dc:creator>` +
      `<cp:lastModifiedBy>${author}</cp:lastModifiedBy>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
      "</cp:coreProperties>"
    );
  }

  private buildAppProps(slideCount: number): string {
    return (
      Xml.declaration() +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      "<Application>DarkSlide</Application>" +
      "<AppVersion>0.4.0</AppVersion>" +
      `<Slides>${slideCount}</Slides>` +
      "</Properties>"
    );
  }

  // ─── presentation.xml ──────────────────────────────────────────────────

  private buildPresentation(slideCount: number): string {
    let sldIdLst = "";
    for (let i = 1; i <= slideCount; i++) {
      const id = 256 + (i - 1);
      sldIdLst += '<p:sldId id="' + id + '" r:id="rId' + (i + 1) + '"/>';
    }
    const slideMasterRid = "rId" + (slideCount + 2);

    return (
      Xml.declaration() +
      '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
      'saveSubsetFonts="1">' +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="' + slideMasterRid + '"/></p:sldMasterIdLst>' +
      '<p:sldIdLst>' + sldIdLst + '</p:sldIdLst>' +
      '<p:sldSz cx="' + Emu.DEFAULT_SLIDE_WIDTH + '" cy="' + Emu.DEFAULT_SLIDE_HEIGHT + '" type="screen16x9"/>' +
      '<p:notesSz cx="' + Emu.DEFAULT_SLIDE_HEIGHT + '" cy="' + Emu.DEFAULT_SLIDE_WIDTH + '"/>' +
      "</p:presentation>"
    );
  }

  private buildPresentationRels(slideCount: number): string {
    let rels =
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>';
    for (let i = 1; i <= slideCount; i++) {
      rels +=
        '<Relationship Id="rId' +
        (i + 1) +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' +
        i +
        '.xml"/>';
    }
    rels +=
      '<Relationship Id="rId' +
      (slideCount + 2) +
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>';

    return (
      Xml.declaration() +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels +
      "</Relationships>"
    );
  }

  // ─── theme / master / layout ───────────────────────────────────────────

  private buildTheme(deck: Any): string {
    const colors: Any = deck?.theme?.colors ?? {};
    const [bg] = Color.parse(colors.background ?? "#FFFFFF", "FFFFFF");
    const [text] = Color.parse(colors.text ?? "#0F172A", "0F172A");
    const [accent] = Color.parse(colors.accent ?? "#8B5CF6", "8B5CF6");
    const [muted] = Color.parse(colors.muted ?? "#44546A", "44546A");
    const [surface] = Color.parse(colors.surface ?? "#E7E6E6", "E7E6E6");

    const heading = Xml.attr(String(deck?.theme?.fonts?.heading ?? "Calibri"));
    const body = Xml.attr(String(deck?.theme?.fonts?.body ?? "Calibri"));

    const palette = [...CHART_PALETTE];
    palette[0] = accent;

    return (
      Xml.declaration() +
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="DarkSlide">' +
      "<a:themeElements>" +
      '<a:clrScheme name="DarkSlide">' +
      '<a:dk1><a:srgbClr val="' + text + '"/></a:dk1>' +
      '<a:lt1><a:srgbClr val="' + bg + '"/></a:lt1>' +
      '<a:dk2><a:srgbClr val="' + muted + '"/></a:dk2>' +
      '<a:lt2><a:srgbClr val="' + surface + '"/></a:lt2>' +
      '<a:accent1><a:srgbClr val="' + palette[0] + '"/></a:accent1>' +
      '<a:accent2><a:srgbClr val="' + palette[1] + '"/></a:accent2>' +
      '<a:accent3><a:srgbClr val="' + palette[2] + '"/></a:accent3>' +
      '<a:accent4><a:srgbClr val="' + palette[3] + '"/></a:accent4>' +
      '<a:accent5><a:srgbClr val="' + palette[4] + '"/></a:accent5>' +
      '<a:accent6><a:srgbClr val="' + palette[5] + '"/></a:accent6>' +
      '<a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
      '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
      "</a:clrScheme>" +
      '<a:fontScheme name="DarkSlide">' +
      '<a:majorFont><a:latin typeface="' + heading + '"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="' + body + '"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>' +
      "</a:fontScheme>" +
      '<a:fmtScheme name="DarkSlide">' +
      '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
      '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
      '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
      '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
      "</a:fmtScheme>" +
      "</a:themeElements>" +
      "</a:theme>"
    );
  }

  private buildSlideMaster(): string {
    return (
      Xml.declaration() +
      '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>' +
      "<p:spTree>" +
      '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      "</p:spTree>" +
      "</p:cSld>" +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      "<p:sldLayoutIdLst>" + this.buildSlideLayoutIdLst() + "</p:sldLayoutIdLst>" +
      "<p:txStyles>" +
      '<p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle>' +
      '<p:bodyStyle><a:lvl1pPr><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle>' +
      "<p:otherStyle/>" +
      "</p:txStyles>" +
      "</p:sldMaster>"
    );
  }

  private buildSlideLayoutIdLst(): string {
    let out = "";
    LAYOUT_ORDER.forEach((_, idx) => {
      const n = idx + 1;
      const id = 2147483648 + n;
      out += '<p:sldLayoutId id="' + id + '" r:id="rId' + n + '"/>';
    });
    return out;
  }

  private buildSlideMasterRels(): string {
    let rels = "";
    LAYOUT_ORDER.forEach((_, idx) => {
      const n = idx + 1;
      rels +=
        '<Relationship Id="rId' +
        n +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout' +
        n +
        '.xml"/>';
    });
    const themeRid = "rId" + (LAYOUT_ORDER.length + 1);
    rels +=
      '<Relationship Id="' +
      themeRid +
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>';

    return (
      Xml.declaration() +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels +
      "</Relationships>"
    );
  }

  private layoutNumberFor(layout: string | null): number {
    if (layout === null || layout === undefined) {
      return 1;
    }
    const idx = LAYOUT_ORDER.indexOf(layout);
    return idx === -1 ? 1 : idx + 1;
  }

  private layoutTypeFor(layout: string): string {
    switch (layout) {
      case "title":
        return "title";
      case "title-content":
        return "obj";
      case "two-column":
        return "twoObj";
      case "section-divider":
        return "secHead";
      case "image-text":
      case "text-image":
        return "picTx";
      case "quote":
        return "obj";
      default:
        return "blank";
    }
  }

  private buildSlideLayout(layout: string): string {
    const type = this.layoutTypeFor(layout);
    const name = Xml.attr(ucwords(layout.replace(/-/g, " ")));

    return (
      Xml.declaration() +
      '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
      'type="' + type + '" preserve="1">' +
      '<p:cSld name="' + name + '">' +
      "<p:spTree>" +
      '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      "</p:spTree>" +
      "</p:cSld>" +
      "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>" +
      "</p:sldLayout>"
    );
  }

  private buildSlideLayoutRels(): string {
    return (
      Xml.declaration() +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>' +
      "</Relationships>"
    );
  }

  // ─── Per-slide rendering ──────────────────────────────────────────────

  private buildSlideXml(slide: Any, slideNumber: number, deck: Any = {}): string {
    const elements: Any[] = [...(slide?.elements ?? [])];
    elements.sort((a, b) => (a?.z ?? -1) - (b?.z ?? -1));

    let shapeId = 2;
    let shapeTreeXml = "";
    let slideRels: Rel[] = [];

    const bgResult = this.buildBackground(slide?.background ?? null, slideNumber, slideRels);
    const bg = bgResult.xml;
    slideRels = bgResult.rels;

    const animatedBuilds: AnimatedBuild[] = [];

    elements.forEach((element, arrayIndex) => {
      if (!isPlainObject(element) || element.type === undefined) {
        return;
      }
      if (element.hidden) {
        return;
      }
      const [xml, rels] = this.buildElementXml(element, shapeId, slideNumber);
      if (xml === "") {
        return;
      }
      shapeTreeXml += xml;
      slideRels = slideRels.concat(rels);

      if (isPlainObject(element.animation) && element.animation.effect !== undefined) {
        let paragraphCount: number | null = null;
        if (element.type === "text" && element.animation.byParagraph) {
          paragraphCount = String(element.content ?? "").split("\n").length;
        }

        animatedBuilds.push({
          shapeId,
          arrayIndex,
          animation: element.animation,
          paragraphCount,
        });
      }

      shapeId++;
    });

    this.pendingSlideRels[slideNumber] = slideRels;

    const transition = this.buildTransition(slide?.transition ?? null, deck?.theme?.defaultTransition ?? null);
    const timing = this.buildTiming(animatedBuilds);

    return (
      Xml.declaration() +
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      "<p:cSld>" +
      bg +
      "<p:spTree>" +
      '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      shapeTreeXml +
      "</p:spTree>" +
      "</p:cSld>" +
      transition +
      timing +
      "</p:sld>"
    );
  }

  private buildTransition(transition: Any, fallback: Any): string {
    let spec: Any = isPlainObject(transition) ? transition : null;
    if (spec === null || (spec.kind ?? null) === null || (spec.kind ?? null) === "none") {
      spec = isPlainObject(fallback) ? fallback : null;
    }
    if (spec === null) {
      return "";
    }

    const kind = typeof spec.kind === "string" ? String(spec.kind).toLowerCase() : "none";
    if (kind === "none" || !(Schema.SLIDE_TRANSITION_KINDS as readonly string[]).includes(kind)) {
      return "";
    }

    const spd = this.transitionSpeed(spec.duration ?? null);

    let effect: string;
    switch (kind) {
      case "fade":
        effect = "<p:fade/>";
        break;
      case "slide":
        effect = '<p:push dir="' + this.transitionDirection(spec.direction ?? null) + '"/>';
        break;
      case "zoom":
        effect = "<p:circle/>";
        break;
      default:
        effect = "";
    }
    if (effect === "") {
      return "";
    }

    return '<p:transition spd="' + spd + '">' + effect + "</p:transition>";
  }

  private transitionSpeed(duration: Any): string {
    if (!isNumeric(duration)) {
      return "med";
    }
    const ms = parseFloat(String(duration));
    if (ms >= 700) {
      return "slow";
    }
    if (ms <= 250) {
      return "fast";
    }
    return "med";
  }

  private transitionDirection(direction: Any): string {
    switch (typeof direction === "string" ? direction.toLowerCase() : "") {
      case "left":
        return "l";
      case "right":
        return "r";
      case "up":
        return "u";
      case "down":
        return "d";
      default:
        return "l";
    }
  }

  // ─── Element entrance animations (`<p:timing>`) ───────────────────────────

  private buildTiming(builds: AnimatedBuild[]): string {
    if (builds.length === 0) {
      return "";
    }

    const sorted = [...builds];
    sorted.sort((a, b) => {
      const ao = isNumeric(a.animation.order) ? parseFloat(String(a.animation.order)) : 0;
      const bo = isNumeric(b.animation.order) ? parseFloat(String(b.animation.order)) : 0;
      if (ao !== bo) {
        return ao < bo ? -1 : 1;
      }
      return a.arrayIndex - b.arrayIndex;
    });

    const subBuilds: SubBuild[] = [];
    for (const build of sorted) {
      const paragraphCount = build.paragraphCount ?? null;
      if (paragraphCount === null || paragraphCount <= 1) {
        subBuilds.push({
          shapeId: build.shapeId,
          arrayIndex: build.arrayIndex,
          animation: build.animation,
          paragraph: paragraphCount === null ? null : 0,
        });
        continue;
      }

      for (let i = 0; i < paragraphCount; i++) {
        const animation: Record<string, Any> = { ...build.animation };
        if (i > 0) {
          animation.trigger = "on-click";
        }
        subBuilds.push({
          shapeId: build.shapeId,
          arrayIndex: build.arrayIndex,
          animation,
          paragraph: i,
        });
      }
    }

    const steps: SubBuild[][] = [];
    for (const build of subBuilds) {
      const trigger = this.animationTrigger(build.animation.trigger ?? null);
      if (steps.length === 0 || trigger === "on-click") {
        steps.push([build]);
      } else {
        steps[steps.length - 1]!.push(build);
      }
    }

    this.tnId = 1;
    const rootId = this.tnId++;

    let stepPars = "";
    for (const step of steps) {
      stepPars += this.buildStepPar(step);
    }

    const mainSeqId = this.tnId++;

    return (
      "<p:timing>" +
      "<p:tnLst>" +
      "<p:par>" +
      '<p:cTn id="' + rootId + '" dur="indefinite" restart="never" nodeType="tmRoot">' +
      "<p:childTnLst>" +
      '<p:seq concurrent="1" nextAc="seek">' +
      '<p:cTn id="' + mainSeqId + '" dur="indefinite" nodeType="mainSeq">' +
      "<p:childTnLst>" +
      stepPars +
      "</p:childTnLst>" +
      "</p:cTn>" +
      '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>' +
      '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>' +
      "</p:seq>" +
      "</p:childTnLst>" +
      "</p:cTn>" +
      "</p:par>" +
      "</p:tnLst>" +
      "</p:timing>"
    );
  }

  private buildTargetEl(spid: number, paragraph: number | null): string {
    if (paragraph === null) {
      return '<p:tgtEl><p:spTgt spid="' + spid + '"/></p:tgtEl>';
    }
    return (
      '<p:tgtEl><p:spTgt spid="' + spid + '">' +
      '<p:txEl><p:pRg st="' + paragraph + '" end="' + paragraph + '"/></p:txEl>' +
      "</p:spTgt></p:tgtEl>"
    );
  }

  private buildStepPar(step: SubBuild[]): string {
    const lead = step[0]!;
    const leadDelay = this.animationDelay(lead.animation);
    const leadDuration = this.animationDuration(lead.animation);

    let childTns = "";
    step.forEach((build, i) => {
      let begin: number;
      if (i === 0) {
        begin = leadDelay;
      } else {
        const trigger = this.animationTrigger(build.animation.trigger ?? null);
        const base = trigger === "after-prev" ? leadDelay + leadDuration : leadDelay;
        begin = base + this.animationDelay(build.animation);
      }
      childTns += this.buildEffectPar(build, begin);
    });

    const stepId = this.tnId++;

    return (
      "<p:par>" +
      '<p:cTn id="' + stepId + '" fill="hold">' +
      '<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>' +
      "<p:childTnLst>" +
      childTns +
      "</p:childTnLst>" +
      "</p:cTn>" +
      "</p:par>"
    );
  }

  private buildEffectPar(build: SubBuild, beginMs: number): string {
    const spid = build.shapeId;
    const paragraph = build.paragraph;
    const animation = build.animation;
    const effect = this.animationEffect(animation.effect ?? null);
    const duration = this.animationDuration(animation);
    const direction = this.animationDirection(animation.direction ?? null);

    const wrapId = this.tnId++;

    const stCond = '<p:stCondLst><p:cond delay="' + Math.max(0, beginMs) + '"/></p:stCondLst>';

    let effectXml: string;
    switch (effect) {
      case "fly-in":
        effectXml = this.buildFlyInEffect(spid, duration, direction, paragraph);
        break;
      case "zoom":
        effectXml = this.buildZoomEffect(spid, duration, paragraph);
        break;
      case "wipe":
        effectXml = this.buildWipeEffect(spid, duration, direction, paragraph);
        break;
      default:
        effectXml = this.buildFadeEffect(spid, duration, paragraph);
    }

    const presetId = this.animationPresetId(effect);

    return (
      "<p:par>" +
      '<p:cTn id="' + wrapId + '" presetID="' + presetId + '" presetClass="entr" presetSubtype="0" fill="hold">' +
      stCond +
      "<p:childTnLst>" +
      effectXml +
      "</p:childTnLst>" +
      "</p:cTn>" +
      "</p:par>"
    );
  }

  private animationPresetId(effect: string): number {
    switch (effect) {
      case "fly-in":
        return 2;
      case "wipe":
        return 22;
      case "zoom":
        return 23;
      default:
        return 10;
    }
  }

  private buildVisibilitySet(spid: number, paragraph: number | null = null): string {
    const id = this.tnId++;

    return (
      "<p:set>" +
      "<p:cBhvr>" +
      '<p:cTn id="' + id + '" dur="1" fill="hold">' +
      '<p:stCondLst><p:cond delay="0"/></p:stCondLst>' +
      "</p:cTn>" +
      this.buildTargetEl(spid, paragraph) +
      "<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>" +
      "</p:cBhvr>" +
      '<p:to><p:strVal val="visible"/></p:to>' +
      "</p:set>"
    );
  }

  private buildFadeEffect(spid: number, durationMs: number, paragraph: number | null = null): string {
    const set = this.buildVisibilitySet(spid, paragraph);
    const id = this.tnId++;

    const effect =
      '<p:animEffect transition="in" filter="fade">' +
      "<p:cBhvr>" +
      '<p:cTn id="' + id + '" dur="' + durationMs + '"/>' +
      this.buildTargetEl(spid, paragraph) +
      "</p:cBhvr>" +
      "</p:animEffect>";

    return set + effect;
  }

  private buildFlyInEffect(spid: number, durationMs: number, direction: string, paragraph: number | null = null): string {
    const set = this.buildVisibilitySet(spid, paragraph);

    let attr: string, fromExpr: string, toExpr: string;
    switch (direction) {
      case "right":
        [attr, fromExpr, toExpr] = ["ppt_x", "1+#ppt_w/2", "#ppt_x"];
        break;
      case "up":
        [attr, fromExpr, toExpr] = ["ppt_y", "0-#ppt_h/2", "#ppt_y"];
        break;
      case "down":
        [attr, fromExpr, toExpr] = ["ppt_y", "1+#ppt_h/2", "#ppt_y"];
        break;
      default:
        [attr, fromExpr, toExpr] = ["ppt_x", "0-#ppt_w/2", "#ppt_x"];
    }

    const id = this.tnId++;

    const anim =
      '<p:anim calcmode="lin" valueType="num">' +
      '<p:cBhvr additive="base">' +
      '<p:cTn id="' + id + '" dur="' + durationMs + '" fill="hold"/>' +
      this.buildTargetEl(spid, paragraph) +
      "<p:attrNameLst><p:attrName>" + attr + "</p:attrName></p:attrNameLst>" +
      "</p:cBhvr>" +
      "<p:tavLst>" +
      '<p:tav tm="0"><p:val><p:strVal val="' + fromExpr + '"/></p:val></p:tav>' +
      '<p:tav tm="100000"><p:val><p:strVal val="' + toExpr + '"/></p:val></p:tav>' +
      "</p:tavLst>" +
      "</p:anim>";

    return set + anim;
  }

  private buildZoomEffect(spid: number, durationMs: number, paragraph: number | null = null): string {
    const set = this.buildVisibilitySet(spid, paragraph);
    const fadeId = this.tnId++;
    const scaleId = this.tnId++;

    const fade =
      '<p:animEffect transition="in" filter="fade">' +
      "<p:cBhvr>" +
      '<p:cTn id="' + fadeId + '" dur="' + durationMs + '"/>' +
      this.buildTargetEl(spid, paragraph) +
      "</p:cBhvr>" +
      "</p:animEffect>";

    const scale =
      "<p:animScale>" +
      "<p:cBhvr>" +
      '<p:cTn id="' + scaleId + '" dur="' + durationMs + '" fill="hold"/>' +
      this.buildTargetEl(spid, paragraph) +
      "</p:cBhvr>" +
      '<p:from x="0" y="0"/>' +
      '<p:to x="100000" y="100000"/>' +
      "</p:animScale>";

    return set + fade + scale;
  }

  private buildWipeEffect(spid: number, durationMs: number, direction: string, paragraph: number | null = null): string {
    const set = this.buildVisibilitySet(spid, paragraph);

    let filter: string;
    switch (direction) {
      case "right":
        filter = "wipe(left)";
        break;
      case "up":
        filter = "wipe(down)";
        break;
      case "down":
        filter = "wipe(up)";
        break;
      default:
        filter = "wipe(right)";
    }

    const id = this.tnId++;

    const effect =
      '<p:animEffect transition="in" filter="' + filter + '">' +
      "<p:cBhvr>" +
      '<p:cTn id="' + id + '" dur="' + durationMs + '"/>' +
      this.buildTargetEl(spid, paragraph) +
      "</p:cBhvr>" +
      "</p:animEffect>";

    return set + effect;
  }

  private animationEffect(effect: Any): string {
    const name = typeof effect === "string" ? effect.toLowerCase() : "";
    return (Schema.ANIMATION_EFFECTS as readonly string[]).includes(name) ? name : "fade";
  }

  private animationTrigger(trigger: Any): string {
    const name = typeof trigger === "string" ? trigger.toLowerCase() : "";
    return (Schema.ANIMATION_TRIGGERS as readonly string[]).includes(name) ? name : "on-click";
  }

  private animationDirection(direction: Any): string {
    const name = typeof direction === "string" ? direction.toLowerCase() : "";
    return (Schema.ANIMATION_DIRECTIONS as readonly string[]).includes(name) ? name : "left";
  }

  private animationDuration(animation: Record<string, Any>): number {
    const duration = isNumeric(animation.duration)
      ? Math.round(parseFloat(String(animation.duration)))
      : Schema.ANIMATION_DEFAULT_DURATION_MS;
    return Math.max(1, duration);
  }

  private animationDelay(animation: Record<string, Any>): number {
    const delay = isNumeric(animation.delay) ? Math.round(parseFloat(String(animation.delay))) : 0;
    return Math.max(0, delay);
  }

  // ─── Background ───────────────────────────────────────────────────────

  private buildBackground(bg: Any, slideNumber: number, rels: Rel[]): { xml: string; rels: Rel[] } {
    if (!isPlainObject(bg)) {
      return { xml: "", rels };
    }

    if (typeof bg.image === "string" && bg.image !== "") {
      const embed = this.stageMedia(bg.image, slideNumber);
      if (embed !== null) {
        rels.push({
          id: embed.relId,
          type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
          target: embed.target,
        });

        return {
          xml:
            "<p:bg><p:bgPr>" +
            '<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="' + embed.relId + '"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill>' +
            "<a:effectLst/></p:bgPr></p:bg>",
          rels,
        };
      }
    }

    if (typeof bg.gradient === "string") {
      const grad = this.parseGradient(bg.gradient);
      if (grad !== null) {
        return { xml: "<p:bg><p:bgPr>" + grad + "<a:effectLst/></p:bgPr></p:bg>", rels };
      }
    }

    if (typeof bg.color === "string") {
      const [hex, alpha] = Color.parse(bg.color);
      return {
        xml:
          '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="' + hex + '"><a:alpha val="' + alpha + '"/></a:srgbClr></a:solidFill><a:effectLst/></p:bgPr></p:bg>',
        rels,
      };
    }

    return { xml: "", rels };
  }

  private parseGradient(cssInput: string): string | null {
    const css = cssInput.trim();
    const m = /^linear-gradient\((.+)\)\s*;?\s*$/i.exec(css);
    if (!m) {
      return null;
    }
    const args = m[1]!;

    const parts = this.splitTopLevelCommas(args);
    if (parts.length < 2) {
      return null;
    }

    let angleDeg = 90.0;
    const first = parts[0]!.trim();
    const directionLike = /^(?:to\s+|[-+]?[0-9.]+(?:deg|rad|turn|grad)?\s*$)/i.test(first);
    if (directionLike) {
      angleDeg = this.parseGradientDirection(first);
      parts.shift();
    }

    const stops: { hex: string; pos: number }[] = [];
    const count = parts.length;
    parts.forEach((partRaw, i) => {
      const part = partRaw.trim();
      let colorStr: string;
      let pos: number;
      const sm = /^(.+?)\s+([0-9.]+%?)\s*$/.exec(part);
      if (sm) {
        colorStr = sm[1]!;
        const posStr = sm[2]!;
        if (posStr.endsWith("%")) {
          pos = parseFloat(posStr.replace(/%+$/, "")) / 100;
        } else {
          pos = parseFloat(posStr);
        }
      } else {
        colorStr = part;
        pos = count <= 1 ? 0.0 : i / (count - 1);
      }
      const [hex] = Color.parse(colorStr);
      stops.push({ hex, pos: Math.max(0.0, Math.min(1.0, pos)) });
    });

    let gsList = "";
    for (const stop of stops) {
      const pos1000 = Math.round(stop.pos * 100000);
      gsList += '<a:gs pos="' + pos1000 + '"><a:srgbClr val="' + stop.hex + '"/></a:gs>';
    }

    let pptxAngle = Math.round((angleDeg - 90) * 60000);
    pptxAngle = ((pptxAngle % (360 * 60000)) + 360 * 60000) % (360 * 60000);

    return (
      '<a:gradFill flip="none" rotWithShape="1">' +
      "<a:gsLst>" + gsList + "</a:gsLst>" +
      '<a:lin ang="' + pptxAngle + '" scaled="0"/>' +
      "</a:gradFill>"
    );
  }

  private splitTopLevelCommas(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let buf = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!;
      if (c === "(") {
        depth++;
        buf += c;
      } else if (c === ")") {
        depth = Math.max(0, depth - 1);
        buf += c;
      } else if (c === "," && depth === 0) {
        out.push(buf);
        buf = "";
      } else {
        buf += c;
      }
    }
    if (buf !== "") {
      out.push(buf);
    }
    return out;
  }

  private parseGradientDirection(dirInput: string): number {
    const dir = dirInput.trim();
    let m = /^([-+]?[0-9.]+)deg$/i.exec(dir);
    if (m) {
      return parseFloat(m[1]!);
    }
    m = /^([-+]?[0-9.]+)rad$/i.exec(dir);
    if (m) {
      return (parseFloat(m[1]!) * 180) / Math.PI;
    }
    m = /^([-+]?[0-9.]+)turn$/i.exec(dir);
    if (m) {
      return parseFloat(m[1]!) * 360;
    }
    switch (dir.toLowerCase()) {
      case "to top":
        return 0;
      case "to top right":
        return 45;
      case "to right":
        return 90;
      case "to bottom right":
        return 135;
      case "to bottom":
        return 180;
      case "to bottom left":
        return 225;
      case "to left":
        return 270;
      case "to top left":
        return 315;
      default:
        return 180;
    }
  }

  // ─── Element dispatch ─────────────────────────────────────────────────

  private buildElementXml(element: Any, shapeId: number, slideNumber: number): [string, Rel[]] {
    const rels: Rel[] = [];
    let xml: string;
    switch (element.type) {
      case "text":
        xml = this.buildTextShape(element, shapeId);
        break;
      case "image":
        xml = this.buildImageShape(element, shapeId, slideNumber, rels);
        break;
      case "shape":
        xml = this.buildShape(element, shapeId);
        break;
      case "code":
        xml = this.buildCodeShape(element, shapeId);
        break;
      case "chart":
        xml = this.buildChart(element, shapeId, slideNumber, rels);
        break;
      case "table":
        xml = this.buildTable(element, shapeId);
        break;
      case "embed":
        xml = this.buildPlaceholder("[embed: " + String(element.src ?? "") + "]", element, shapeId);
        break;
      default:
        xml = "";
    }

    xml = this.applyHyperlink(xml, element, shapeId, rels);

    return [xml, rels];
  }

  private applyHyperlink(xml: string, element: Any, shapeId: number, rels: Rel[]): string {
    const href = element.href ?? null;
    if (typeof href !== "string" || href === "" || xml === "") {
      return xml;
    }

    const relId = "rIdLink" + shapeId;
    rels.push({
      id: relId,
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
      target: href,
      mode: "External",
    });

    const hlink = '<a:hlinkClick r:id="' + relId + '"/>';
    let count = 0;
    const injected = xml.replace(/<p:cNvPr\b([^>]*)\/>/, (_full, attrs: string) => {
      if (count > 0) return _full;
      count++;
      return "<p:cNvPr" + attrs + ">" + hlink + "</p:cNvPr>";
    });

    return count > 0 ? injected : xml;
  }

  // ─── Element renderers ────────────────────────────────────────────────

  private buildTextShape(element: Any, shapeId: number): string {
    const xfrm = this.xfrmFromFractions(element);
    const body = this.buildTextBody(
      String(element.content ?? ""),
      element.style ?? {},
      String(element.format ?? "plain"),
    );
    const id = element.id ?? `text-${shapeId}`;

    return (
      "<p:sp>" +
      "<p:nvSpPr>" +
      '<p:cNvPr id="' + shapeId + '" name="' + Xml.attr(String(id)) + '"/>' +
      '<p:cNvSpPr txBox="1"/>' +
      "<p:nvPr/>" +
      "</p:nvSpPr>" +
      "<p:spPr>" +
      xfrm +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      "<a:noFill/>" +
      "</p:spPr>" +
      body +
      "</p:sp>"
    );
  }

  private buildImageShape(element: Any, shapeId: number, slideNumber: number, rels: Rel[]): string {
    const src = String(element.src ?? "");
    const embed = this.stageMedia(src, slideNumber);
    if (embed === null) {
      return this.buildPlaceholder("[image: " + src + "]", element, shapeId);
    }
    const relId = embed.relId;
    rels.push({
      id: relId,
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
      target: embed.target,
    });

    const id = element.id ?? `image-${shapeId}`;
    const alt = Xml.attr(String(element.alt ?? ""));
    const fit = typeof element.fit === "string" ? element.fit.toLowerCase() : "fill";

    const boxX = Emu.fromFracX(toFloat(element.x ?? 0));
    const boxY = Emu.fromFracY(toFloat(element.y ?? 0));
    const boxW = Math.max(1, Emu.fromFracX(toFloat(element.w ?? 0)));
    const boxH = Math.max(1, Emu.fromFracY(toFloat(element.h ?? 0)));

    const intrinsic = getImageSize(embed.bytes);
    const imgW = intrinsic ? intrinsic[0] : 0;
    const imgH = intrinsic ? intrinsic[1] : 0;

    let offX = boxX;
    let offY = boxY;
    let extW = boxW;
    let extH = boxH;
    let srcRect = "";

    const explicitCrop = this.imageCropRect(element.crop ?? null);
    if (explicitCrop !== null) {
      srcRect = explicitCrop;
    } else if (fit === "cover" && imgW > 0 && imgH > 0) {
      srcRect = this.coverSrcRect(boxW, boxH, imgW, imgH);
    } else if ((fit === "contain" || fit === "scale-down") && imgW > 0 && imgH > 0) {
      [offX, offY, extW, extH] = this.containedRect(boxX, boxY, boxW, boxH, imgW, imgH);
    }

    const blipFill =
      '<p:blipFill><a:blip r:embed="' + relId + '"/>' + srcRect + "<a:stretch><a:fillRect/></a:stretch></p:blipFill>";

    return (
      "<p:pic>" +
      "<p:nvPicPr>" +
      '<p:cNvPr id="' + shapeId + '" name="' + Xml.attr(String(id)) + '" descr="' + alt + '"/>' +
      '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>' +
      "<p:nvPr/>" +
      "</p:nvPicPr>" +
      blipFill +
      "<p:spPr>" +
      '<a:xfrm><a:off x="' + offX + '" y="' + offY + '"/><a:ext cx="' + extW + '" cy="' + extH + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      "</p:spPr>" +
      "</p:pic>"
    );
  }

  private imageCropRect(crop: Any): string | null {
    if (!isPlainObject(crop)) {
      return null;
    }
    const x = isNumeric(crop.x) ? parseFloat(String(crop.x)) : null;
    const y = isNumeric(crop.y) ? parseFloat(String(crop.y)) : null;
    const w = isNumeric(crop.w) ? parseFloat(String(crop.w)) : null;
    const h = isNumeric(crop.h) ? parseFloat(String(crop.h)) : null;
    if (x === null || y === null || w === null || h === null) {
      return null;
    }
    let l = Math.round(x * 100000);
    let t = Math.round(y * 100000);
    let r = Math.round((1 - x - w) * 100000);
    let b = Math.round((1 - y - h) * 100000);
    l = Math.max(0, Math.min(100000, l));
    t = Math.max(0, Math.min(100000, t));
    r = Math.max(0, Math.min(100000, r));
    b = Math.max(0, Math.min(100000, b));

    return '<a:srcRect l="' + l + '" t="' + t + '" r="' + r + '" b="' + b + '"/>';
  }

  private coverSrcRect(boxW: number, boxH: number, imgW: number, imgH: number): string {
    const boxAspect = boxW / boxH;
    const imgAspect = imgW / imgH;
    let l = 0,
      t = 0,
      r = 0,
      b = 0;

    if (imgAspect > boxAspect) {
      const visibleFrac = boxAspect / imgAspect;
      const inset = Math.round(((1 - visibleFrac) / 2) * 100000);
      l = inset;
      r = inset;
    } else if (imgAspect < boxAspect) {
      const visibleFrac = imgAspect / boxAspect;
      const inset = Math.round(((1 - visibleFrac) / 2) * 100000);
      t = inset;
      b = inset;
    }

    return '<a:srcRect l="' + l + '" t="' + t + '" r="' + r + '" b="' + b + '"/>';
  }

  private containedRect(
    boxX: number,
    boxY: number,
    boxW: number,
    boxH: number,
    imgW: number,
    imgH: number,
  ): [number, number, number, number] {
    const scale = Math.min(boxW / imgW, boxH / imgH);
    const extW = Math.max(1, Math.round(imgW * scale));
    const extH = Math.max(1, Math.round(imgH * scale));
    const offX = boxX + Math.round((boxW - extW) / 2);
    const offY = boxY + Math.round((boxH - extH) / 2);

    return [offX, offY, extW, extH];
  }

  private buildShape(element: Any, shapeId: number): string {
    const xfrm = this.xfrmFromFractions(element);
    const id = element.id ?? `shape-${shapeId}`;
    const kind = String(element.shape ?? "rect");
    let prst: string;
    switch (kind) {
      case "rect":
        prst = "rect";
        break;
      case "rounded-rect":
        prst = "roundRect";
        break;
      case "ellipse":
        prst = "ellipse";
        break;
      case "triangle":
        prst = "triangle";
        break;
      case "line":
        prst = "line";
        break;
      case "arrow":
        prst = "rightArrow";
        break;
      default:
        prst = "rect";
    }

    const [fillHex, fillAlpha] = Color.parse(element.fill ?? "rgba(139,92,246,0.15)", "8B5CF6");
    const [strokeHex] = Color.parse(element.stroke ?? "#8B5CF6", "8B5CF6");
    const strokeWidthEmu = Emu.fromPt(toFloat(element.strokeWidth ?? 2));
    const dashStr = element.dashed ? '<a:prstDash val="dash"/>' : "";

    const fillXml =
      fillAlpha === 0
        ? "<a:noFill/>"
        : '<a:solidFill><a:srgbClr val="' + fillHex + '"><a:alpha val="' + fillAlpha + '"/></a:srgbClr></a:solidFill>';

    return (
      "<p:sp>" +
      "<p:nvSpPr>" +
      '<p:cNvPr id="' + shapeId + '" name="' + Xml.attr(String(id)) + '"/>' +
      "<p:cNvSpPr/>" +
      "<p:nvPr/>" +
      "</p:nvSpPr>" +
      "<p:spPr>" +
      xfrm +
      '<a:prstGeom prst="' + prst + '"><a:avLst/></a:prstGeom>' +
      fillXml +
      '<a:ln w="' + strokeWidthEmu + '"><a:solidFill><a:srgbClr val="' + strokeHex + '"/></a:solidFill>' + dashStr + "</a:ln>" +
      "</p:spPr>" +
      '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>' +
      "</p:sp>"
    );
  }

  private buildCodeShape(element: Any, shapeId: number): string {
    const xfrm = this.xfrmFromFractions(element);
    const code = String(element.code ?? "");
    const id = element.id ?? `code-${shapeId}`;
    const language = element.language !== undefined && element.language !== null ? String(element.language) : null;
    const body = this.buildHighlightedCodeBody(code, language);

    return (
      "<p:sp>" +
      "<p:nvSpPr>" +
      '<p:cNvPr id="' + shapeId + '" name="' + Xml.attr(String(id)) + '"/>' +
      '<p:cNvSpPr txBox="1"/>' +
      "<p:nvPr/>" +
      "</p:nvSpPr>" +
      "<p:spPr>" +
      xfrm +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      '<a:solidFill><a:srgbClr val="0F172A"/></a:solidFill>' +
      "</p:spPr>" +
      body +
      "</p:sp>"
    );
  }

  private buildHighlightedCodeBody(code: string, language: string | null): string {
    const sz = Emu.hundredthsOfPoint(12);
    let paragraphs = "";
    const lines = code.split("\n");
    for (const line of lines) {
      const tokens = SyntaxHighlighter.tokenize(line, language);
      let runs = "";
      for (const token of tokens) {
        if (token.text === "") {
          continue;
        }
        const color = SyntaxHighlighter.colorFor(token.kind);
        runs +=
          "<a:r>" +
          '<a:rPr lang="en-US" sz="' + sz + '">' +
          '<a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill>' +
          '<a:latin typeface="Consolas"/>' +
          "</a:rPr>" +
          "<a:t>" + Xml.text(token.text) + "</a:t>" +
          "</a:r>";
      }
      if (runs === "") {
        runs = '<a:endParaRPr lang="en-US" sz="' + sz + '"/>';
      }
      paragraphs += '<a:p><a:pPr algn="l"/>' + runs + "</a:p>";
    }

    return (
      "<p:txBody>" +
      '<a:bodyPr wrap="square" anchor="t" rtlCol="0" lIns="91440" tIns="45720" rIns="91440" bIns="45720"/>' +
      "<a:lstStyle/>" +
      paragraphs +
      "</p:txBody>"
    );
  }

  private buildTable(element: Any, shapeId: number): string {
    const columns: Any[] = Array.isArray(element.columns) ? element.columns : [];
    const rows: Any[] = Array.isArray(element.rows) ? element.rows : [];
    if (columns.length === 0) {
      return this.buildPlaceholder("[table: no columns]", element, shapeId);
    }

    const totalWidthEmu = Emu.fromFracX(toFloat(element.w ?? 0.5));
    const colCount = columns.length;
    const colWidthEmu = Math.round(totalWidthEmu / Math.max(1, colCount));

    const headerRowH = Emu.fromPt(40);
    const bodyRowH = Emu.fromPt(30);

    let gridCols = "";
    for (let i = 0; i < columns.length; i++) {
      gridCols += '<a:gridCol w="' + colWidthEmu + '"/>';
    }

    let headerCells = "";
    for (const col of columns) {
      const label = String(col.label ?? col.key ?? "");
      headerCells += this.buildTableCell(label, true);
    }
    const headerRow = '<a:tr h="' + headerRowH + '">' + headerCells + "</a:tr>";

    let bodyRows = "";
    let rowIndex = 0;
    for (const row of rows) {
      if (!isPlainObject(row)) {
        continue;
      }
      let cells = "";
      for (const col of columns) {
        const key = String(col.key ?? "");
        const value = row[key] ?? "";
        const text = isScalar(value) ? scalarToString(value) : JSON.stringify(value);
        cells += this.buildTableCell(String(text), false, rowIndex % 2 === 1);
      }
      bodyRows += '<a:tr h="' + bodyRowH + '">' + cells + "</a:tr>";
      rowIndex++;
    }

    const xfrm = this.xfrmFromFractions(element);
    const id = element.id ?? `table-${shapeId}`;

    return (
      "<p:graphicFrame>" +
      "<p:nvGraphicFramePr>" +
      '<p:cNvPr id="' + shapeId + '" name="' + Xml.attr(String(id)) + '"/>' +
      '<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>' +
      "<p:nvPr/>" +
      "</p:nvGraphicFramePr>" +
      "<p:xfrm>" + innerXfrm(xfrm) + "</p:xfrm>" +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">' +
      "<a:tbl>" +
      '<a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr>' +
      "<a:tblGrid>" + gridCols + "</a:tblGrid>" +
      headerRow +
      bodyRows +
      "</a:tbl>" +
      "</a:graphicData>" +
      "</a:graphic>" +
      "</p:graphicFrame>"
    );
  }

  private buildTableCell(text: string, header: boolean, striped = false): string {
    let fill: string;
    let textColor: string;
    let bold: string;
    if (header) {
      fill = '<a:solidFill><a:srgbClr val="8B5CF6"/></a:solidFill>';
      textColor = "FFFFFF";
      bold = ' b="1"';
    } else {
      fill = striped ? '<a:solidFill><a:srgbClr val="F8FAFC"/></a:solidFill>' : "<a:noFill/>";
      textColor = "0F172A";
      bold = "";
    }

    return (
      "<a:tc>" +
      "<a:txBody>" +
      '<a:bodyPr wrap="square" anchor="ctr" lIns="91440" tIns="45720" rIns="91440" bIns="45720"/>' +
      "<a:lstStyle/>" +
      '<a:p><a:pPr algn="l"/><a:r><a:rPr lang="en-US" sz="1400"' + bold + '><a:solidFill><a:srgbClr val="' + textColor + '"/></a:solidFill></a:rPr><a:t>' + Xml.text(text) + "</a:t></a:r></a:p>" +
      "</a:txBody>" +
      "<a:tcPr>" + fill + "</a:tcPr>" +
      "</a:tc>"
    );
  }

  // ─── Charts ───────────────────────────────────────────────────────────

  private buildChart(element: Any, shapeId: number, slideNumber: number, rels: Rel[]): string {
    const option = isPlainObject(element.option) ? element.option : null;
    const spec = option !== null ? ChartTranslator.translate(option) : null;

    if (spec !== null) {
      this.chartCounter++;
      const n = this.chartCounter;
      const archivePath = `ppt/charts/chart${n}.xml`;
      this.chartFiles.push({ path: archivePath, xml: this.buildChartPart(spec) });

      const relId = "rIdChart" + n;
      rels.push({
        id: relId,
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
        target: `../charts/chart${n}.xml`,
      });

      return this.buildChartFrame(element, shapeId, relId);
    }

    const preRender = this.chartPreRenderSrc(element);
    if (preRender !== null) {
      const imageElement = { ...element };
      imageElement.src = preRender;
      imageElement.fit = element.fit ?? "contain";

      return this.buildImageShape(imageElement, shapeId, slideNumber, rels);
    }

    let title = "";
    if (isPlainObject(option)) {
      title = String((option as Any).title?.text ?? "");
    }
    const label = title !== "" ? title : "chart";

    return this.buildChartPlaceholder(label, element, shapeId);
  }

  private chartPreRenderSrc(element: Any): string | null {
    for (const key of ["image", "src"]) {
      const value = element[key] ?? null;
      if (typeof value === "string" && value.startsWith("data:")) {
        return value;
      }
    }
    return null;
  }

  private buildChartFrame(element: Any, shapeId: number, relId: string): string {
    const xfrm = this.xfrmFromFractions(element);
    const innerX = innerXfrm(xfrm);
    const id = element.id ?? `chart-${shapeId}`;

    return (
      "<p:graphicFrame>" +
      "<p:nvGraphicFramePr>" +
      '<p:cNvPr id="' + shapeId + '" name="' + Xml.attr(String(id)) + '"/>' +
      "<p:cNvGraphicFramePr/>" +
      "<p:nvPr/>" +
      "</p:nvGraphicFramePr>" +
      "<p:xfrm>" + innerX + "</p:xfrm>" +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<a:graphicData uri="' + NS_CHART + '">' +
      '<c:chart xmlns:c="' + NS_CHART + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="' + relId + '"/>' +
      "</a:graphicData>" +
      "</a:graphic>" +
      "</p:graphicFrame>"
    );
  }

  private buildChartPart(spec: ChartSpec): string {
    const kind = spec.kind;
    let plot: string;
    switch (kind) {
      case "bar":
        plot = this.buildBarChartXml(spec);
        break;
      case "line":
        plot = this.buildLineChartXml(spec);
        break;
      case "pie":
        plot = this.buildPieChartXml(spec);
        break;
      case "scatter":
        plot = this.buildScatterChartXml(spec);
        break;
      default:
        plot = this.buildBarChartXml(spec);
    }

    let title: string;
    if (spec.title !== "") {
      title =
        "<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>" +
        Xml.text(spec.title) +
        '</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>';
    } else {
      title = '<c:autoTitleDeleted val="1"/>';
    }

    return (
      Xml.declaration() +
      '<c:chartSpace xmlns:c="' + NS_CHART + '" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      "<c:chart>" +
      title +
      "<c:plotArea>" +
      "<c:layout/>" +
      plot +
      "</c:plotArea>" +
      '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>' +
      '<c:plotVisOnly val="1"/>' +
      '<c:dispBlanksAs val="gap"/>' +
      "</c:chart>" +
      "</c:chartSpace>"
    );
  }

  private buildBarChartXml(spec: ChartSpec): string {
    let sers = "";
    spec.series.forEach((series, idx) => {
      sers +=
        "<c:ser>" +
        '<c:idx val="' + idx + '"/>' +
        '<c:order val="' + idx + '"/>' +
        this.chartSeriesName(series, idx) +
        this.chartSeriesFill(idx) +
        this.chartCatRef(spec.categories, series.values) +
        this.chartValRef(series.values) +
        "</c:ser>";
    });

    return (
      "<c:barChart>" +
      '<c:barDir val="col"/>' +
      '<c:grouping val="clustered"/>' +
      '<c:varyColors val="0"/>' +
      sers +
      '<c:axId val="111111111"/>' +
      '<c:axId val="222222222"/>' +
      "</c:barChart>" +
      this.buildCatValAxes()
    );
  }

  private buildLineChartXml(spec: ChartSpec): string {
    let isArea = false;
    for (const series of spec.series) {
      if (series.area) {
        isArea = true;
        break;
      }
    }

    let sers = "";
    spec.series.forEach((series, idx) => {
      const smooth = !isArea && series.smooth ? '<c:smooth val="1"/>' : "";
      sers +=
        "<c:ser>" +
        '<c:idx val="' + idx + '"/>' +
        '<c:order val="' + idx + '"/>' +
        this.chartSeriesName(series, idx) +
        this.chartSeriesLine(idx) +
        this.chartCatRef(spec.categories, series.values) +
        this.chartValRef(series.values) +
        smooth +
        "</c:ser>";
    });

    if (isArea) {
      return (
        "<c:areaChart>" +
        '<c:grouping val="standard"/>' +
        '<c:varyColors val="0"/>' +
        sers +
        '<c:axId val="111111111"/>' +
        '<c:axId val="222222222"/>' +
        "</c:areaChart>" +
        this.buildCatValAxes()
      );
    }

    return (
      "<c:lineChart>" +
      '<c:grouping val="standard"/>' +
      '<c:varyColors val="0"/>' +
      sers +
      '<c:marker val="1"/>' +
      '<c:axId val="111111111"/>' +
      '<c:axId val="222222222"/>' +
      "</c:lineChart>" +
      this.buildCatValAxes()
    );
  }

  private buildPieChartXml(spec: ChartSpec): string {
    const series: Any = spec.series[0] ?? { values: [], name: "" };
    const values: number[] = Array.isArray(series.values) ? series.values : [];
    const categories = spec.categories;

    let dPts = "";
    values.forEach((_, idx) => {
      dPts +=
        "<c:dPt>" +
        '<c:idx val="' + idx + '"/>' +
        '<c:bubble3D val="0"/>' +
        '<c:spPr><a:solidFill><a:srgbClr val="' + this.chartColor(idx) + '"/></a:solidFill></c:spPr>' +
        "</c:dPt>";
    });

    return (
      "<c:pieChart>" +
      '<c:varyColors val="1"/>' +
      "<c:ser>" +
      '<c:idx val="0"/>' +
      '<c:order val="0"/>' +
      this.chartSeriesName(series, 0) +
      dPts +
      this.chartCatRef(categories, values) +
      this.chartValRef(values) +
      "</c:ser>" +
      '<c:firstSliceAng val="0"/>' +
      "</c:pieChart>"
    );
  }

  private buildScatterChartXml(spec: ChartSpec): string {
    let sers = "";
    spec.series.forEach((series, idx) => {
      const points: Any[] = Array.isArray(series.points) ? series.points : [];
      const xs: number[] = [];
      const ys: number[] = [];
      for (const point of points) {
        xs.push(toFloat(point.x ?? 0));
        ys.push(toFloat(point.y ?? 0));
      }
      sers +=
        "<c:ser>" +
        '<c:idx val="' + idx + '"/>' +
        '<c:order val="' + idx + '"/>' +
        this.chartSeriesName(series, idx) +
        '<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr>' +
        '<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="' + this.chartColor(idx) + '"/></a:solidFill></c:spPr></c:marker>' +
        "<c:xVal>" + this.numLit(xs) + "</c:xVal>" +
        "<c:yVal>" + this.numLit(ys) + "</c:yVal>" +
        "</c:ser>";
    });

    return (
      "<c:scatterChart>" +
      '<c:scatterStyle val="lineMarker"/>' +
      '<c:varyColors val="0"/>' +
      sers +
      '<c:axId val="111111111"/>' +
      '<c:axId val="222222222"/>' +
      "</c:scatterChart>" +
      '<c:valAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222222222"/></c:valAx>' +
      '<c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="111111111"/></c:valAx>'
    );
  }

  private buildCatValAxes(): string {
    return (
      "<c:catAx>" +
      '<c:axId val="111111111"/>' +
      '<c:scaling><c:orientation val="minMax"/></c:scaling>' +
      '<c:delete val="0"/>' +
      '<c:axPos val="b"/>' +
      '<c:crossAx val="222222222"/>' +
      "</c:catAx>" +
      "<c:valAx>" +
      '<c:axId val="222222222"/>' +
      '<c:scaling><c:orientation val="minMax"/></c:scaling>' +
      '<c:delete val="0"/>' +
      '<c:axPos val="l"/>' +
      '<c:crossAx val="111111111"/>' +
      "</c:valAx>"
    );
  }

  private chartSeriesName(series: Any, idx: number): string {
    const name =
      typeof series.name === "string" && series.name !== "" ? String(series.name) : "Series " + (idx + 1);

    return (
      '<c:tx><c:strRef><c:f>Sheet1!$A$' + (idx + 1) + '</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>' + Xml.text(name) + "</c:v></c:pt></c:strCache></c:strRef></c:tx>"
    );
  }

  private chartSeriesFill(idx: number): string {
    return '<c:spPr><a:solidFill><a:srgbClr val="' + this.chartColor(idx) + '"/></a:solidFill></c:spPr>';
  }

  private chartSeriesLine(idx: number): string {
    return '<c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="' + this.chartColor(idx) + '"/></a:solidFill></a:ln></c:spPr>';
  }

  private chartCatRef(categoriesInput: string[], values: number[]): string {
    let categories = categoriesInput;
    if (categories.length === 0) {
      categories = [];
      for (let i = 0; i < values.length; i++) {
        categories.push(String(i + 1));
      }
    }

    let pts = "";
    categories.forEach((label, i) => {
      pts += '<c:pt idx="' + i + '"><c:v>' + Xml.text(String(label)) + "</c:v></c:pt>";
    });

    return '<c:cat><c:strLit><c:ptCount val="' + categories.length + '"/>' + pts + "</c:strLit></c:cat>";
  }

  private chartValRef(values: number[]): string {
    return "<c:val>" + this.numLit(values) + "</c:val>";
  }

  private numLit(values: number[]): string {
    let pts = "";
    values.forEach((value, i) => {
      pts += '<c:pt idx="' + i + '"><c:v>' + this.numStr(toFloat(value)) + "</c:v></c:pt>";
    });

    return '<c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="' + values.length + '"/>' + pts + "</c:numLit>";
  }

  private numStr(value: number): string {
    if (value === Math.floor(value) && Math.abs(value) < 1.0e15) {
      return String(Math.trunc(value));
    }
    return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }

  private chartColor(idx: number): string {
    if (idx === 0) {
      return this.themeAccent;
    }
    return CHART_PALETTE[idx % CHART_PALETTE.length]!;
  }

  private buildChartPlaceholder(label: string, element: Any, shapeId: number): string {
    const xfrm = this.xfrmFromFractions(element);
    const id = element.id ?? `chart-${shapeId}`;

    return (
      "<p:sp>" +
      "<p:nvSpPr>" +
      '<p:cNvPr id="' + shapeId + '" name="' + Xml.attr(String(id)) + '"/>' +
      "<p:cNvSpPr/>" +
      "<p:nvPr/>" +
      "</p:nvSpPr>" +
      "<p:spPr>" +
      xfrm +
      '<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>' +
      '<a:solidFill><a:srgbClr val="F1F5F9"/></a:solidFill>' +
      '<a:ln w="12700"><a:solidFill><a:srgbClr val="CBD5E1"/></a:solidFill></a:ln>' +
      "</p:spPr>" +
      "<p:txBody>" +
      '<a:bodyPr wrap="square" anchor="ctr" rtlCol="0"/>' +
      "<a:lstStyle/>" +
      '<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1600" b="1"><a:solidFill><a:srgbClr val="64748B"/></a:solidFill></a:rPr><a:t>' + Xml.text(label) + "</a:t></a:r></a:p>" +
      "</p:txBody>" +
      "</p:sp>"
    );
  }

  private buildPlaceholder(label: string, element: Any, shapeId: number): string {
    return this.buildTextShape(
      {
        id: element.id ?? `placeholder-${shapeId}`,
        type: "text",
        x: element.x ?? 0.1,
        y: element.y ?? 0.4,
        w: element.w ?? 0.8,
        h: element.h ?? 0.2,
        content: label,
        format: "plain",
        style: { fontSize: 20, align: "center", color: "#64748B" },
      },
      shapeId,
    );
  }

  // ─── Text body / paragraphs / runs ────────────────────────────────────

  private buildTextBody(content: string, style: Any, format: string): string {
    const fontPt = toFloat(style.fontSize ?? 24);
    const pt = Math.max(8.0, fontPt / 2);
    const sz = Emu.hundredthsOfPoint(pt);
    const baseBold = this.weightToBold(style.weight ?? null);
    const baseItalic = style.italic ? ' i="1"' : "";
    const baseUnderline = style.underline ? ' u="sng"' : "";
    const align = this.alignToAlgn(String(style.align ?? "left"));
    const [colorHex] = Color.parse(String(style.color ?? "#0F172A"), "0F172A");
    const fontFamily =
      style.fontFamily !== undefined && style.fontFamily !== null
        ? '<a:latin typeface="' + Xml.attr(String(style.fontFamily)) + '"/>'
        : "";
    let anchor: string;
    switch (style.verticalAlign ?? "top") {
      case "middle":
        anchor = 't="ctr"';
        break;
      case "bottom":
        anchor = 't="b"';
        break;
      default:
        anchor = 't="t"';
    }

    const renderRuns = format === "markdown";

    let paragraphs = "";
    const lines = content.split("\n");
    for (const line of lines) {
      let headingLevel = 0;
      let isBullet = false;
      let body = line;
      if (renderRuns) {
        [headingLevel, body] = MarkdownInline.headingPrefix(line);
        if (headingLevel === 0) {
          [isBullet, body] = MarkdownInline.bulletPrefix(line);
        }
      }

      let paragraphSz = sz;
      let paragraphBold = baseBold;
      if (headingLevel > 0) {
        let multiplier: number;
        switch (headingLevel) {
          case 1:
            multiplier = 1.8;
            break;
          case 2:
            multiplier = 1.45;
            break;
          case 3:
            multiplier = 1.2;
            break;
          default:
            multiplier = 1.0;
        }
        paragraphSz = Emu.hundredthsOfPoint(pt * multiplier);
        paragraphBold = ' b="1"';
      }

      let pPr = '<a:pPr algn="' + align + '"';
      if (isBullet) {
        pPr += ' indent="-228600" marL="228600"><a:buFont typeface="Arial"/><a:buChar char="•"/>';
      } else {
        pPr += "><a:buNone/>";
      }
      pPr += "</a:pPr>";

      let runs = "";
      if (renderRuns) {
        const tokens = MarkdownInline.tokenize(body);
        for (const token of tokens) {
          runs += this.buildRun(
            token.text,
            paragraphSz,
            paragraphBold,
            baseItalic,
            baseUnderline,
            colorHex,
            fontFamily,
            token.b,
            token.i,
            token.code,
          );
        }
      } else {
        runs = this.buildRun(body, paragraphSz, paragraphBold, baseItalic, baseUnderline, colorHex, fontFamily, false, false, false);
      }

      paragraphs += "<a:p>" + pPr + runs + "</a:p>";
    }

    return (
      "<p:txBody>" +
      '<a:bodyPr wrap="square" anchor="' + anchor.slice(3, -1) + '" rtlCol="0"/>' +
      "<a:lstStyle/>" +
      paragraphs +
      "</p:txBody>"
    );
  }

  private buildRun(
    text: string,
    sz: number,
    baseBold: string,
    baseItalic: string,
    baseUnderline: string,
    colorHex: string,
    fontFamily: string,
    bold: boolean,
    italic: boolean,
    code: boolean,
  ): string {
    const b = bold ? ' b="1"' : baseBold;
    const i = (italic ? ' i="1"' : "") || baseItalic;
    const u = baseUnderline;
    let color = colorHex;
    let family = fontFamily;

    if (code) {
      color = "8B5CF6";
      family = '<a:latin typeface="Consolas"/>';
    }

    const rPr =
      '<a:rPr lang="en-US" sz="' + sz + '"' + b + i + u + '><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill>' + family + "</a:rPr>";

    return "<a:r>" + rPr + "<a:t>" + Xml.text(text) + "</a:t></a:r>";
  }

  private weightToBold(weight: Any): string {
    if (isNumeric(weight) && toInt(weight) >= 600) {
      return ' b="1"';
    }
    if (weight === "bold" || weight === "semibold") {
      return ' b="1"';
    }
    return "";
  }

  private alignToAlgn(align: string): string {
    switch (align) {
      case "center":
        return "ctr";
      case "right":
        return "r";
      case "justify":
        return "just";
      default:
        return "l";
    }
  }

  // ─── Geometry helper ──────────────────────────────────────────────────

  private xfrmFromFractions(element: Any): string {
    const x = Emu.fromFracX(toFloat(element.x ?? 0));
    const y = Emu.fromFracY(toFloat(element.y ?? 0));
    const cx = Emu.fromFracX(toFloat(element.w ?? 0));
    const cy = Emu.fromFracY(toFloat(element.h ?? 0));
    const rot = element.rotation !== undefined ? Math.round(toFloat(element.rotation) * 60000) : 0;
    const rotAttr = rot !== 0 ? ' rot="' + rot + '"' : "";

    return '<a:xfrm' + rotAttr + '><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>';
  }

  // ─── Media staging ────────────────────────────────────────────────────

  private stageMedia(src: string, _slideNumber: number): StagedMedia | null {
    const data = this.loadImageBytes(src);
    if (data === null) {
      return null;
    }
    this.mediaCounter++;
    const i = this.mediaCounter;
    const ext = this.extensionForMime(data.mime) ?? "png";
    const archivePath = `ppt/media/image${i}.${ext}`;
    this.mediaFiles.push({ path: archivePath, bytes: data.bytes });

    const relId = "rId" + i;

    return {
      relId,
      target: `../media/image${i}.${ext}`,
      bytes: data.bytes,
    };
  }

  private loadImageBytes(src: string): MediaData | null {
    // data: URI — decode inline.
    const m = /^data:([^;,]+)(?:;base64)?,([\s\S]*)$/.exec(src);
    if (m) {
      const mime = m[1]!;
      const payload = m[2]!;
      let bytes: Uint8Array | null;
      if (src.includes(";base64,")) {
        try {
          bytes = base64Decode(payload);
        } catch {
          bytes = null;
        }
      } else {
        try {
          bytes = ENCODER.encode(decodeURIComponent(payload));
        } catch {
          bytes = null;
        }
      }
      if (bytes === null) {
        return null;
      }
      return { bytes, mime };
    }

    // file://, local paths, and http(s) cannot be fetched synchronously in an
    // isomorphic context — PHP reads them from disk / network. Returning null
    // here replicates the PHP "couldn't obtain image" path (placeholder).
    return null;
  }

  private extensionForMime(mime: string): string | null {
    switch (mime) {
      case "image/png":
        return "png";
      case "image/jpeg":
        return "jpg";
      case "image/gif":
        return "gif";
      case "image/svg+xml":
        return "svg";
      case "image/webp":
        return "webp";
      default:
        return null;
    }
  }

  // ─── Slide rels ───────────────────────────────────────────────────────

  private buildSlideRels(slideNumber: number, hasNotes: boolean, layoutNumber = 1): string {
    let rels = "";
    rels +=
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout' + layoutNumber + '.xml"/>';
    let nextRelNum = 2;

    if (hasNotes) {
      rels +=
        '<Relationship Id="rId' + nextRelNum + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide' + slideNumber + '.xml"/>';
      nextRelNum++;
    }

    for (const rel of this.pendingSlideRels[slideNumber] ?? []) {
      const mode = (rel.mode ?? null) === "External" ? ' TargetMode="External"' : "";
      rels +=
        '<Relationship Id="' + Xml.attr(rel.id) + '" Type="' + Xml.attr(rel.type) + '" Target="' + Xml.attr(rel.target) + '"' + mode + "/>";
    }

    return (
      Xml.declaration() +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels +
      "</Relationships>"
    );
  }

  // ─── Notes slides ─────────────────────────────────────────────────────

  private buildNotesSlideXml(slide: Any, _slideNumber: number): string {
    const notes = String(slide.notes ?? "");
    let paragraphs = "";
    for (const line of notes.split("\n")) {
      paragraphs += '<a:p><a:r><a:rPr lang="en-US" sz="1200"/><a:t>' + Xml.text(line) + "</a:t></a:r></a:p>";
    }

    return (
      Xml.declaration() +
      '<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      "<p:cSld>" +
      "<p:spTree>" +
      '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      "<p:sp>" +
      "<p:nvSpPr>" +
      '<p:cNvPr id="2" name="Notes Placeholder"/>' +
      '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
      '<p:nvPr><p:ph type="body"/></p:nvPr>' +
      "</p:nvSpPr>" +
      '<p:spPr><a:xfrm><a:off x="685800" y="1700213"/><a:ext cx="5772150" cy="3679371"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
      "<p:txBody><a:bodyPr/><a:lstStyle/>" +
      paragraphs +
      "</p:txBody>" +
      "</p:sp>" +
      "</p:spTree>" +
      "</p:cSld>" +
      "</p:notes>"
    );
  }

  private buildNotesSlideRels(slideNumber: number): string {
    return (
      Xml.declaration() +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide' + slideNumber + '.xml"/>' +
      "</Relationships>"
    );
  }
}

// ─── Module helpers ──────────────────────────────────────────────────────

/** PHP `(float)` cast — non-numeric → 0. */
function toFloat(v: Any): number {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** PHP `ucwords` — uppercase first letter of each space-delimited word. */
function ucwords(s: string): string {
  return s.replace(/(^|\s)([a-z])/g, (_m, sp: string, ch: string) => sp + ch.toUpperCase());
}

/** Slice the inner content of an `<a:xfrm>...</a:xfrm>` wrapper. */
function innerXfrm(xfrm: string): string {
  return xfrm.slice("<a:xfrm>".length, -"</a:xfrm>".length);
}

function isScalar(v: Any): boolean {
  return (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    v === null ||
    typeof v === "bigint"
  );
}

/** PHP `(string)` cast of a scalar (true→"1", false→"", null→""). */
function scalarToString(v: Any): string {
  if (v === true) return "1";
  if (v === false) return "";
  if (v === null) return "";
  return String(v);
}

/**
 * Read intrinsic width/height from PNG / GIF / JPEG byte headers. Mirrors PHP's
 * `getimagesizefromstring` for the cases the writer cares about (cover/contain
 * fit). Returns null when the dimensions can't be determined.
 */
function getImageSize(bytes: Uint8Array): [number, number] | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    // PNG: IHDR width/height at offset 16 (big-endian).
    const w = (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
    const h = (bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!;
    return [w >>> 0, h >>> 0];
  }
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    // GIF: width/height little-endian at offset 6.
    const w = bytes[6]! | (bytes[7]! << 8);
    const h = bytes[8]! | (bytes[9]! << 8);
    return [w, h];
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // JPEG: scan SOF markers for dimensions.
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = (bytes[i + 5]! << 8) | bytes[i + 6]!;
        const w = (bytes[i + 7]! << 8) | bytes[i + 8]!;
        return [w, h];
      }
      const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
      i += 2 + len;
    }
  }
  return null;
}
