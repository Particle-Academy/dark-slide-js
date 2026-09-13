/**
 * The box a text element lives in: fill, outline, corner radius, insets — and
 * the left accent bar that makes a callout a callout. Mirrors PHP
 * `Text\BoxDecoration`.
 *
 * ## Why the accent bar is a gradient
 *
 * DrawingML has no per-side border on a shape: `<a:ln>` is all four sides or
 * none. So a coloured bar down one edge has always meant a second shape
 * underneath, which pushes z-ordering and geometry onto whoever authors the
 * deck — and an agent emitting three elements that have to line up is three
 * chances to get it wrong.
 *
 * `<a:gradFill>` with two stops at ADJACENT positions is a hard edge, not a
 * blend. Four stops therefore paint a bar and a flat tint in a single shape,
 * with no extra element, no z-order and no second shape id for the animation
 * builder to renumber. Verified rendering before it was designed in.
 */
import { Color } from "../helpers/color";
import { DesignUnits } from "../helpers/design-units";
import { Emu } from "../helpers/emu";
import { Xml } from "../helpers/xml";
import { isNumeric, isPlainObject } from "../util";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Gap between the accent bar and the text when nothing says otherwise. */
export const ACCENT_GUTTER_PT = 8.0;

export const BoxDecoration = {
  ACCENT_GUTTER_PT,

  roundRectGeometry(radiusPx: number, widthEmu: number, heightEmu: number, theme: Any = {}): string {
    return roundRectGeometry(radiusPx, widthEmu, heightEmu, theme);
  },

  /** The `<p:spPr>` interior: geometry, fill and line, in schema order. */
  spPr(style: Any, widthEmu: number, heightEmu: number, theme: Any = {}): string {
    return geometry(style, widthEmu, heightEmu, theme) + fill(style, widthEmu, theme) + line(style, theme);
  },

  hasDecoration(style: Any): boolean {
    return (
      style?.fill !== undefined ||
      style?.accentBar !== undefined ||
      style?.border !== undefined ||
      style?.radius !== undefined
    );
  },

  /**
   * `lIns`/`tIns`/`rIns`/`bIns` for the text body, or an empty string when the
   * element says nothing — decks that predate this keep their bytes.
   *
   * An accent bar with no explicit padding gets a left inset wide enough to
   * clear it, because text printed on top of the bar is the obvious way for
   * this feature to look broken.
   */
  bodyInsets(style: Any, theme: Any = {}): string {
    const padding = style?.padding ?? null;
    const bar: Any = isPlainObject(style?.accentBar) ? style.accentBar : null;

    if ((padding === null || padding === undefined) && bar === null) return "";

    // PowerPoint's own defaults, in points, which is what an undecorated box uses.
    const sides: Record<string, number> = { left: 7.2, right: 7.2, top: 3.6, bottom: 3.6 };

    if (bar !== null && (bar.side ?? "left") !== "right") {
      sides.left = barWidthPt(bar, theme) + ACCENT_GUTTER_PT;
    }
    if (bar !== null && (bar.side ?? "left") === "right") {
      sides.right = barWidthPt(bar, theme) + ACCENT_GUTTER_PT;
    }

    // Stated padding is design pixels.
    if (isNumeric(padding)) {
      for (const k of Object.keys(sides)) sides[k] = DesignUnits.toPt(Number(padding), theme);
    } else if (isPlainObject(padding)) {
      for (const k of Object.keys(sides)) {
        if (isNumeric(padding[k])) sides[k] = DesignUnits.toPt(Number(padding[k]), theme);
      }
    }

    return (
      ` lIns="${Emu.fromPt(sides.left!)}"` +
      ` tIns="${Emu.fromPt(sides.top!)}"` +
      ` rIns="${Emu.fromPt(sides.right!)}"` +
      ` bIns="${Emu.fromPt(sides.bottom!)}"`
    );
  },
};

/** The accent bar's width in points: a stated width is design pixels, the default bar is 4pt. */
function barWidthPt(bar: Any, theme: Any): number {
  return isNumeric(bar?.width) ? DesignUnits.toPt(Number(bar.width), theme) : 4.0;
}

function geometry(style: Any, widthEmu: number, heightEmu: number, theme: Any): string {
  const radius = style?.radius ?? null;
  if (!isNumeric(radius) || Number(radius) <= 0) {
    return '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  }

  return roundRectGeometry(Number(radius), widthEmu, heightEmu, theme);
}

/**
 * A `roundRect` whose corners have the given radius, in design pixels. Mirrors
 * PHP `BoxDecoration::roundRectGeometry`.
 *
 * DrawingML defines the corner radius as `min(w, h) * adj / 100000`, with `adj`
 * pinned to 0..50000 (so 50000 is a pill). Read off LibreOffice's own preset
 * table, `share/filter/oox-drawingml-cs-presets`, whose roundRect equations are
 * `pin(0, adj, 50000)`, `min(logwidth, logheight)` and `?1 * ?0 / 100000`. This
 * used to divide by HALF the shorter side, which drew every corner at twice the
 * radius asked for.
 *
 * Shared by decorated text boxes and `rounded-rect` shapes, so the two cannot
 * disagree about what a radius means.
 */
export function roundRectGeometry(radiusPx: number, widthEmu: number, heightEmu: number, theme: Any = {}): string {
  const shorter = Math.max(1, Math.min(widthEmu, heightEmu));
  let adj = Math.round((Emu.fromPt(DesignUnits.toPt(radiusPx, theme)) / shorter) * 100000);
  adj = Math.max(0, Math.min(50000, adj));

  return `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`;
}

function fill(style: Any, widthEmu: number, theme: Any): string {
  const bar: Any = isPlainObject(style?.accentBar) ? style.accentBar : null;
  const hasFill = style?.fill !== undefined && style.fill !== false && style.fill !== "none";

  if (bar === null) {
    if (!hasFill) return "<a:noFill/>";
    const [hex] = Color.parse(String(style.fill), "FFFFFF");
    return `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
  }

  const [barHex] = Color.parse(String(bar.color ?? "#8B5CF6"), "8B5CF6");
  const [restHex] = Color.parse(hasFill ? String(style.fill) : "#FFFFFF", "FFFFFF");

  const barEmu = Emu.fromPt(barWidthPt(bar, theme));
  let pos = widthEmu > 0 ? Math.round((barEmu / widthEmu) * 100000) : 1000;
  pos = Math.max(1, Math.min(99998, pos));

  const right = (bar.side ?? "left") === "right";

  let stops: string;
  if (right) {
    const edge = 100000 - pos;
    stops =
      `<a:gs pos="0"><a:srgbClr val="${restHex}"/></a:gs>` +
      `<a:gs pos="${edge - 1}"><a:srgbClr val="${restHex}"/></a:gs>` +
      `<a:gs pos="${edge}"><a:srgbClr val="${barHex}"/></a:gs>` +
      `<a:gs pos="100000"><a:srgbClr val="${barHex}"/></a:gs>`;
  } else {
    stops =
      `<a:gs pos="0"><a:srgbClr val="${barHex}"/></a:gs>` +
      `<a:gs pos="${pos}"><a:srgbClr val="${barHex}"/></a:gs>` +
      `<a:gs pos="${pos + 1}"><a:srgbClr val="${restHex}"/></a:gs>` +
      `<a:gs pos="100000"><a:srgbClr val="${restHex}"/></a:gs>`;
  }

  return `<a:gradFill flip="none" rotWithShape="0"><a:gsLst>${stops}</a:gsLst><a:lin ang="0" scaled="0"/></a:gradFill>`;
}

function line(style: Any, theme: Any): string {
  const border = style?.border ?? null;
  if (border === null || border === undefined || border === false || border === "none") return "";
  if (!isPlainObject(border)) return "";

  // A stated width is design pixels; the default outline is 1pt.
  const width = isNumeric(border.width) ? DesignUnits.toPt(Number(border.width), theme) : 1.0;
  if (width <= 0) return "";

  const [hex] = Color.parse(String(border.color ?? "#CBD5E1"), "CBD5E1");
  const dash = (border.style ?? "solid") !== "solid" ? `<a:prstDash val="${Xml.attr(String(border.style))}"/>` : "";

  return `<a:ln w="${Emu.fromPt(width)}"><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>${dash}</a:ln>`;
}
