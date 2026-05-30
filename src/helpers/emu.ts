/** EMU conversion helpers. Mirrors PHP `Helpers\Emu`. 914,400 EMU = 1 inch. */
export const EMU_PER_INCH = 914400;
export const DEFAULT_SLIDE_WIDTH = 9144000;
export const DEFAULT_SLIDE_HEIGHT = 5143500;

export const Emu = {
  EMU_PER_INCH,
  DEFAULT_SLIDE_WIDTH,
  DEFAULT_SLIDE_HEIGHT,

  fromFracX(f: number, slideWidthEmu = DEFAULT_SLIDE_WIDTH): number {
    return Math.round(f * slideWidthEmu);
  },
  fromFracY(f: number, slideHeightEmu = DEFAULT_SLIDE_HEIGHT): number {
    return Math.round(f * slideHeightEmu);
  },
  toFracX(emu: number, slideWidthEmu = DEFAULT_SLIDE_WIDTH): number {
    return slideWidthEmu === 0 ? 0 : emu / slideWidthEmu;
  },
  toFracY(emu: number, slideHeightEmu = DEFAULT_SLIDE_HEIGHT): number {
    return slideHeightEmu === 0 ? 0 : emu / slideHeightEmu;
  },
  fromPt(pt: number): number {
    return Math.round(pt * (EMU_PER_INCH / 72));
  },
  hundredthsOfPoint(pt: number): number {
    return Math.round(pt * 100);
  },
};
