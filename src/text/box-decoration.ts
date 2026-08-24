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
import { Emu } from "../helpers/emu";
import { Xml } from "../helpers/xml";
import { isNumeric, isPlainObject } from "../util";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Gap between the accent bar and the text when nothing says otherwise. */
export const ACCENT_GUTTER_PT = 8.0;

export const BoxDecoration = {
  ACCENT_GUTTER_PT,

  /** The `<p:spPr>` interior: geometry, fill and line, in schema order. */
  spPr(style: Any, widthEmu: number, heightEmu: number): string {
    return geometry(style, widthEmu, heightEmu) + fill(style, widthEmu) + line(style);
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
  bodyInsets(style: Any): string {
    const padding = style?.padding ?? null;
    const bar: Any = isPlainObject(style?.accentBar) ? style.accentBar : null;

    if ((padding === null || padding === undefined) && bar === null) return "";

    // PowerPoint's own defaults, which is what an undecorated box uses.
    const sides: Record<string, number> = { left: 7.2, right: 7.2, top: 3.6, bottom: 3.6 };

    if (bar !== null && (bar.side ?? "left") !== "right") {
      sides.left = Number(bar.width ?? 4) + ACCENT_GUTTER_PT;
    }
    if (bar !== null && (bar.side ?? "left") === "right") {
      sides.right = Number(bar.width ?? 4) + ACCENT_GUTTER_PT;
    }

    if (isNumeric(padding)) {
      for (const k of Object.keys(sides)) sides[k] = Number(padding);
    } else if (isPlainObject(padding)) {
      for (const k of Object.keys(sides)) {
        if (isNumeric(padding[k])) sides[k] = Number(padding[k]);
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

function geometry(style: Any, widthEmu: number, heightEmu: number): string {
  const radius = style?.radius ?? null;
  if (!isNumeric(radius) || Number(radius) <= 0) {
    return '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  }

  // `adj` is a proportion of HALF the shorter side, in 1/1000 of a percent.
  const shorter = Math.max(1, Math.min(widthEmu, heightEmu));
  let adj = Math.round((Emu.fromPt(Number(radius)) / (shorter / 2)) * 100000);
  adj = Math.max(0, Math.min(50000, adj));

  return `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`;
}

function fill(style: Any, widthEmu: number): string {
  const bar: Any = isPlainObject(style?.accentBar) ? style.accentBar : null;
  const hasFill = style?.fill !== undefined && style.fill !== false && style.fill !== "none";

  if (bar === null) {
    if (!hasFill) return "<a:noFill/>";
    const [hex] = Color.parse(String(style.fill), "FFFFFF");
    return `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
  }

  const [barHex] = Color.parse(String(bar.color ?? "#8B5CF6"), "8B5CF6");
  const [restHex] = Color.parse(hasFill ? String(style.fill) : "#FFFFFF", "FFFFFF");

  const barEmu = Emu.fromPt(Number(bar.width ?? 4));
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

function line(style: Any): string {
  const border = style?.border ?? null;
  if (border === null || border === undefined || border === false || border === "none") return "";
  if (!isPlainObject(border)) return "";

  const width = isNumeric(border.width) ? Number(border.width) : 1.0;
  if (width <= 0) return "";

  const [hex] = Color.parse(String(border.color ?? "#CBD5E1"), "CBD5E1");
  const dash = (border.style ?? "solid") !== "solid" ? `<a:prstDash val="${Xml.attr(String(border.style))}"/>` : "";

  return `<a:ln w="${Emu.fromPt(width)}"><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>${dash}</a:ln>`;
}
