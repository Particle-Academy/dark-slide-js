/**
 * The fonts a host asked to embed, validated and wrapped, ready to write.
 * Mirrors PHP `Fonts\EmbeddedFonts`, including the order parts are numbered in
 * and the text of every refusal.
 *
 * Supplied through the write options, never through the deck:
 *
 *   Agent.toBytes(deck, { fonts: {
 *     "Bebas Neue": { regular: bebasRegularBytes },
 *     Inter: { regular: interRegular, bold: interBold },
 *   } });
 *
 * The deck is agent-authored JSON; a font is a licensed binary the host owns.
 * Each variant is the font's bytes (a `Uint8Array` or `ArrayBuffer`). This
 * package is isomorphic, so it never reads a path; the PHP engine additionally
 * accepts a file path.
 *
 * Refused, all at once, never skipped: a licence that forbids embedding (OS/2
 * `fsType` Restricted License without a less restrictive bit, or bitmap-only),
 * a file whose own family name differs from the typeface it was supplied for,
 * and anything `TrueTypeFont.fromBytes` will not accept.
 */
import { EmbeddedOpenType } from "./embedded-open-type";
import { FontEmbeddingException } from "./font-embedding-exception";
import { TrueTypeFont } from "./true-type-font";

export const FONT_VARIANTS = ["regular", "bold", "italic", "boldItalic"] as const;
export type FontVariant = (typeof FONT_VARIANTS)[number];

export type FontSource = Uint8Array | ArrayBuffer;
export type FontOptions = Record<string, Partial<Record<FontVariant, FontSource>>>;

export interface EmbeddedFontPart {
  typeface: string;
  variant: FontVariant;
  part: string;
  bytes: Uint8Array;
}

const FS_RESTRICTED = 0x0002;
const FS_PREVIEW_PRINT = 0x0004;
const FS_EDITABLE = 0x0008;
const FS_BITMAP_ONLY = 0x0200;

/** PHP `trim()`'s default character set. */
function phpTrim(s: string): string {
  return s.replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, "");
}

/** PHP `strcasecmp` equality: ASCII letters fold, nothing else does. */
function asciiCaseEquals(a: string, b: string): boolean {
  const fold = (s: string) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
  return fold(a) === fold(b);
}

function hex4(n: number): string {
  return n.toString(16).toUpperCase().padStart(4, "0");
}

export class EmbeddedFonts {
  private constructor(readonly parts: EmbeddedFontPart[]) {}

  static none(): EmbeddedFonts {
    return new EmbeddedFonts([]);
  }

  /** @throws FontEmbeddingException */
  static fromOptions(fonts: FontOptions): EmbeddedFonts {
    const parts: EmbeddedFontPart[] = [];
    const problems: string[] = [];

    for (const [typeface, variants] of Object.entries(fonts)) {
      if (phpTrim(typeface) === "") {
        problems.push("a font was supplied with an empty typeface name");
        continue;
      }
      if (variants === null || typeof variants !== "object" || Object.keys(variants).length === 0) {
        problems.push(`${typeface}: no font files; give at least 'regular'`);
        continue;
      }
      for (const key of Object.keys(variants)) {
        if (!(FONT_VARIANTS as readonly string[]).includes(key)) {
          problems.push(`${typeface}: '${key}' is not a variant; use ${FONT_VARIANTS.join(", ")}`);
        }
      }

      for (const variant of FONT_VARIANTS) {
        if (!Object.prototype.hasOwnProperty.call(variants, variant)) continue;
        try {
          const font = TrueTypeFont.fromBytes(load(variants[variant]));
          assertEmbeddable(font, typeface);
          parts.push({
            typeface,
            variant,
            part: `ppt/fonts/font${parts.length + 1}.fntdata`,
            bytes: EmbeddedOpenType.wrap(font, typeface),
          });
        } catch (e) {
          if (!(e instanceof FontEmbeddingException)) throw e;
          problems.push(`${typeface} (${variant}): ${e.message}`);
        }
      }
    }

    if (problems.length > 0) {
      throw new FontEmbeddingException("These fonts cannot be embedded:\n- " + problems.join("\n- "));
    }

    return new EmbeddedFonts(parts);
  }

  isEmpty(): boolean {
    return this.parts.length === 0;
  }

  /** The parts grouped by typeface, in the order they were supplied: typeface => variant => part path. */
  byTypeface(): Map<string, Map<FontVariant, string>> {
    const grouped = new Map<string, Map<FontVariant, string>>();
    for (const part of this.parts) {
      if (!grouped.has(part.typeface)) grouped.set(part.typeface, new Map());
      grouped.get(part.typeface)!.set(part.variant, part.part);
    }
    return grouped;
  }
}

function load(source: unknown): Uint8Array {
  if (source instanceof Uint8Array && source.length > 0) return source;
  if (source instanceof ArrayBuffer && source.byteLength > 0) return new Uint8Array(source);
  throw new FontEmbeddingException("expected the font bytes (a Uint8Array or ArrayBuffer)");
}

function assertEmbeddable(font: TrueTypeFont, typeface: string): void {
  const fsType = font.fsType();

  // Bits 0-3 were not mutually exclusive before OS/2 version 3; the least
  // restrictive one set is the one that applies.
  const permissive = FS_PREVIEW_PRINT | FS_EDITABLE;
  if ((fsType & FS_RESTRICTED) !== 0 && (fsType & permissive) === 0) {
    throw new FontEmbeddingException(`its licence forbids embedding (OS/2 fsType 0x${hex4(fsType)}, Restricted License)`);
  }
  if ((fsType & FS_BITMAP_ONLY) !== 0) {
    throw new FontEmbeddingException(`its licence allows bitmap embedding only (OS/2 fsType 0x${hex4(fsType)})`);
  }

  const family = font.family();
  if (family === null || !asciiCaseEquals(phpTrim(family), phpTrim(typeface))) {
    throw new FontEmbeddingException(
      `the file's family name is '${family ?? "(none)"}', not '${typeface}'; a deck references a face by that name, so this font would never be used`,
    );
  }
}
