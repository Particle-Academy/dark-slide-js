/**
 * The deck's design canvas, mapped onto the PPTX slide. One place, one formula.
 * Mirrors PHP `Helpers\DesignUnits` exactly.
 *
 * ## The model
 *
 * A deck is authored on a design canvas `theme.slideWidth` pixels wide (1920 by
 * default), exactly as `@particle-academy/fancy-slides` renders it: position and
 * size are fractions of the slide, and every authored LENGTH is a design pixel
 * (`fontSize`, `strokeWidth`, `letterSpacing`, `spaceBefore`, `spaceAfter`,
 * `padding`, `radius`, border and accent-bar widths, table row heights). The
 * canvas scales to the slide, so a length keeps its share of the slide width:
 *
 *   points = px * 720 / designWidth       (the slide is 10in = 720pt wide)
 *
 * `fontSize: 96` on the default canvas is 36pt, 5% of the slide width in
 * PowerPoint and in fancy-slides' preview alike.
 *
 * Until 0.8 the writer halved `fontSize` into points with an 8pt floor and took
 * every other length as points. `theme.slideWidth: 1440` gives exactly the old
 * text sizes (720 / 1440 = 0.5).
 *
 * A built-in default that is PowerPoint's own (7.2pt / 3.6pt insets, a 1pt
 * outline, a 0.75pt table rule, 40pt / 30pt minimum rows) stays in points. Only
 * a value the deck states is converted.
 *
 * Every engine computes `px * 720 / designWidth` in that order, so the
 * floating-point result, and therefore every rounded EMU, agrees.
 */
import { Emu } from "./emu";
import { isNumeric } from "../util";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export const DEFAULT_DESIGN_WIDTH = 1920.0;

/** The slide is 10 inches wide: 9144000 EMU / 12700 EMU per point. */
export const SLIDE_WIDTH_PT = 720.0;

/** A PPTX font size has to be at least 1pt (`ST_TextFontSize` starts at 100). */
export const MIN_FONT_PT = 1.0;

export const DesignUnits = {
  DEFAULT_DESIGN_WIDTH,
  SLIDE_WIDTH_PT,
  MIN_FONT_PT,

  designWidth(theme: Any): number {
    const width = theme?.slideWidth;
    return isNumeric(width) && Number(width) > 0 ? Number(width) : DEFAULT_DESIGN_WIDTH;
  },

  toPt(px: number, theme: Any): number {
    return (px * SLIDE_WIDTH_PT) / DesignUnits.designWidth(theme);
  },

  fontPt(px: number, theme: Any): number {
    return Math.max(MIN_FONT_PT, DesignUnits.toPt(px, theme));
  },

  /**
   * The slide height: 10in wide, `theme.aspectRatio` (width / height, 16/9 by
   * default, as fancy-slides reads it) decides the rest.
   */
  slideHeightEmu(theme: Any): number {
    const ratio = theme?.aspectRatio;
    if (!isNumeric(ratio) || Number(ratio) <= 0) {
      return Emu.DEFAULT_SLIDE_HEIGHT;
    }
    return Math.round(Emu.DEFAULT_SLIDE_WIDTH / Number(ratio));
  },

  /** The named `<p:sldSz type>` for a 10in-wide slide of this height, or null for a custom size. */
  slideSizeType(heightEmu: number): string | null {
    switch (heightEmu) {
      case 5143500:
        return "screen16x9";
      case 5715000:
        return "screen16x10";
      case 6858000:
        return "screen4x3";
      default:
        return null;
    }
  },
};
