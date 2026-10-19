import { DesignUnits } from "./helpers/design-units";
import { isNumeric, isPlainObject } from "./util";

/**
 * Layout findings for a deck, from the deck alone. Mirrors PHP `DarkSlide\Lint`
 * rule for rule and message for message; read that class for the metrics and
 * why they are conservative. The same cases run in all three engines.
 */

type Any = any;

export interface LintFinding {
  code: "text-overflow" | "overlap" | "off-slide" | "kpi-overflow" | "small-text";
  /** 1-based. */
  slide: number;
  element: string;
  message: string;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_PT = 12;
const BOLD_GLYPH = 0.62;
const GLYPH = 0.55;
const LINE = 1.25;
const KPI_PAD = 64;

export function lintDeck(deck: Any): LintFinding[] {
  const theme = isPlainObject(deck?.theme) ? deck.theme : {};
  const canvasW = DesignUnits.designWidth(theme);
  const ratio = isNumeric(theme.aspectRatio) && Number(theme.aspectRatio) > 0 ? Number(theme.aspectRatio) : 16 / 9;
  const canvasH = canvasW / ratio;
  const headingFont = typeof theme.fonts?.heading === "string" ? theme.fonts.heading : "";

  const findings: LintFinding[] = [];
  const slides: Any[] = Array.isArray(deck?.slides) ? deck.slides : [];
  slides.forEach((slide, n) => {
    const slideNo = n + 1;
    const items: { id: string; type: string; box: Box; extent: Box }[] = [];
    const elements: Any[] = Array.isArray(slide?.elements) ? slide.elements : [];
    elements.forEach((el, i) => {
      if (!isPlainObject(el)) return;
      const b = box(el);
      if (b === null) return;
      const id = label(el.id) ?? `element ${i + 1}`;
      const type = typeof el.type === "string" ? el.type : "";

      if (b.x < -0.001 || b.y < -0.001 || b.x + b.w > 1.001 || b.y + b.h > 1.001) {
        findings.push(finding("off-slide", slideNo, id, "The box runs off the slide: x + w and y + h must stay within 0..1."));
      }

      const extent: Box = { ...b };
      if (type === "text") {
        const style = isPlainObject(el.style) ? el.style : {};
        const font = isNumeric(style.fontSize) && typeof style.fontSize !== "boolean" ? Number(style.fontSize) : 28;
        const need = textHeight(el, style, font, b.w * canvasW, canvasW, headingFont);
        if (need !== null) {
          const needH = need / canvasH;
          extent.h = needH;
          extent.y =
            style.verticalAlign === "middle"
              ? b.y + (b.h - needH) / 2
              : style.verticalAlign === "bottom"
                ? b.y + b.h - needH
                : b.y;
          if (need > b.h * canvasH + 1) {
            const up = up2(needH);
            findings.push(
              finding(
                "text-overflow",
                slideNo,
                id,
                `At ${num(font)}px this text needs about ${up} of the slide height and its box is ${num(b.h)}: it will wrap past the box, more so in a substitute font. Make h at least ${up} and move what is below it down, shorten the text, or lower fontSize.`,
              ),
            );
          }
        }
        const pt = (font * 720) / canvasW;
        if (pt < MIN_PT) {
          findings.push(
            finding(
              "small-text",
              slideNo,
              id,
              `fontSize ${num(font)} is ${num(Math.floor(pt * 10) / 10)}pt on the slide: too small to read when projected. Use ${num(Math.ceil((MIN_PT * canvasW) / 720))} (12pt) or more.`,
            ),
          );
        }
      }

      if (type === "kpiBand") {
        const message = kpi(el, b, canvasW);
        if (message !== null) findings.push(finding("kpi-overflow", slideNo, id, message));
      }

      items.push({ id, type, box: b, extent });
    });

    for (const a of items) {
      if (a.type !== "text") continue;
      for (const o of items) {
        if (a.id === o.id || contains(o.box, a.box) || contains(a.box, o.box)) continue;
        if (intersects(a.extent, o.type === "text" ? o.extent : o.box)) {
          findings.push(
            finding(
              "overlap",
              slideNo,
              a.id,
              `Its text runs into "${o.id}". Place one below the other's bottom edge (y + h) with a gap of at least 0.02.`,
            ),
          );
        }
      }
    }
  });

  return findings;
}

function finding(code: LintFinding["code"], slide: number, element: string, message: string): LintFinding {
  return { code, slide, element, message };
}

function box(el: Any): Box | null {
  for (const k of ["x", "y", "w", "h"]) {
    if (typeof el[k] !== "number" || !Number.isFinite(el[k])) return null;
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

/** A string, or an integer as a string; null otherwise. Mirrors PHP Lint::label. */
function label(v: unknown): string | null {
  if (typeof v === "string") return v;
  return typeof v === "number" && Number.isInteger(v) ? String(v) : null;
}

/** Code points, as PHP's preg_match_all('/./us') counts them. */
function chars(s: string): number {
  return [...s].length;
}

function textHeight(el: Any, style: Any, font: number, boxW: number, canvasW: number, headingFont: string): number | null {
  const content = el.content;
  if (typeof content !== "string" || content.trim() === "") return null;
  const weight = style.weight;
  const bold =
    (isNumeric(weight) && typeof weight !== "boolean" && Math.trunc(Number(weight)) >= 600) ||
    weight === "bold" ||
    (headingFont !== "" && style.fontFamily === headingFont);
  const glyph = (bold ? BOLD_GLYPH : GLYPH) * font;
  const [padX, padY] = padding(style, canvasW);
  const usable = Math.max(1, boxW - 2 * padX);

  let lines = 0;
  for (const line of content.split("\n")) {
    const plain = line.replace(/\*\*|__|`/g, "").replace(/^[ \t]*[-*][ \t]+/, "").replace(/^#+[ \t]+/, "");
    lines += Math.max(1, Math.ceil((chars(plain) * glyph) / usable));
  }
  return lines * LINE * font + 2 * padY;
}

function padding(style: Any, canvasW: number): [number, number] {
  const p = style.padding;
  if (typeof p === "number" && Number.isFinite(p)) return [p, p];
  if (isPlainObject(p) || Array.isArray(p)) {
    const q = p as Any;
    const x = q.left ?? q.x;
    const y = q.top ?? q.y;
    if (isNumeric(x) && isNumeric(y)) return [Number(x), Number(y)];
  }
  return [(7.2 * canvasW) / 720, (3.6 * canvasW) / 720];
}

function kpi(el: Any, b: Box, canvasW: number): string | null {
  const items: Any[] = (Array.isArray(el.items) ? el.items : []).filter((i: unknown) => isPlainObject(i) || Array.isArray(i));
  if (items.length === 0) return null;
  const style = isPlainObject(el.style) ? el.style : {};
  const size = isNumeric(style.valueFontSize) && typeof style.valueFontSize !== "boolean" ? Number(style.valueFontSize) : 40;
  const cell = (b.w * canvasW) / items.length;
  let longest = 0;
  for (const item of items) longest = Math.max(longest, chars(label(item.value) ?? ""));
  const need = longest * BOLD_GLYPH * size + KPI_PAD;
  if (longest === 0 || need <= cell) return null;
  return `A ${longest}-character value at valueFontSize ${num(size)} needs about ${Math.ceil(need)}px and each of the ${items.length} cells is ${Math.floor(cell)}px: values will run into each other. Lower valueFontSize to ${Math.floor((cell - KPI_PAD) / (longest * BOLD_GLYPH))} or less.`;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w - 0.001 && b.x < a.x + a.w - 0.001 && a.y < b.y + b.h - 0.001 && b.y < a.y + a.h - 0.001;
}

function contains(outer: Box, inner: Box): boolean {
  return (
    outer.x <= inner.x + 0.001 &&
    outer.y <= inner.y + 0.001 &&
    outer.x + outer.w >= inner.x + inner.w - 0.001 &&
    outer.y + outer.h >= inner.y + inner.h - 0.001
  );
}

/** Rounded UP to 2 decimals, shown with 2. Mirrors PHP Lint::up2. */
function up2(v: number): string {
  return (Math.ceil(Number((v * 100).toFixed(6))) / 100).toFixed(2);
}

/** Shown as authored: 88 -> "88", 7.5 -> "7.5". Mirrors PHP Lint::num. */
function num(v: number): string {
  return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
