/**
 * Color parsing → [hex (RRGGBB, uppercase), alpha (0..100000 PPTX units)].
 * Mirrors PHP `Helpers\Color`.
 */
const NAMED: Record<string, string> = {
  black: "000000",
  white: "FFFFFF",
  red: "FF0000",
  green: "008000",
  blue: "0000FF",
  yellow: "FFFF00",
  cyan: "00FFFF",
  magenta: "FF00FF",
  gray: "808080",
  grey: "808080",
  silver: "C0C0C0",
  maroon: "800000",
  olive: "808000",
  lime: "00FF00",
  aqua: "00FFFF",
  teal: "008080",
  navy: "000080",
  fuchsia: "FF00FF",
  purple: "800080",
  orange: "FFA500",
};

export const Color = {
  parse(color: string | null | undefined, fallbackHex = "000000"): [string, number] {
    if (color === null || color === undefined || color === "") return [fallbackHex, 100000];
    const c = color.trim();

    if (c === "transparent" || c === "none") return [fallbackHex, 0];

    let m = /^#([0-9a-fA-F]{3})$/.exec(c);
    if (m) {
      const h = m[1]!;
      const hex = (h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!).toUpperCase();
      return [hex, 100000];
    }
    m = /^#([0-9a-fA-F]{6})$/.exec(c);
    if (m) return [m[1]!.toUpperCase(), 100000];
    m = /^#([0-9a-fA-F]{8})$/.exec(c);
    if (m) {
      const hex = m[1]!.slice(0, 6).toUpperCase();
      const a = parseInt(m[1]!.slice(6, 8), 16);
      return [hex, Math.round((a / 255) * 100000)];
    }

    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)$/i.exec(c);
    if (m) {
      const r = parseInt(m[1]!, 10);
      const g = parseInt(m[2]!, 10);
      const b = parseInt(m[3]!, 10);
      const a = m[4] !== undefined ? parseFloat(m[4]) : 1.0;
      const hex = [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase();
      return [hex, Math.round(a * 100000)];
    }

    const named = NAMED[c.toLowerCase()];
    if (named !== undefined) return [named, 100000];

    return [fallbackHex, 100000];
  },
};
