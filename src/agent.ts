/**
 * Agent — the structured-tool surface for DarkSlide. Mirrors PHP `Agent`.
 * Universal methods are synchronous; file-touching methods (`write`) are async
 * and Node-only (browsers have no sync FS).
 */

import { SchemaException } from "./exceptions";
import { PptxReader } from "./reader/pptx-reader";
import { Repairer } from "./schema/repairer";
import { Schema } from "./schema/schema";
import type { RepairResult, ValidationError, WriteOptions, WriteResult } from "./schema/types";
import { Validator } from "./schema/validator";
import { PptxWriter } from "./writer/pptx-writer";

/** Feature-parity baseline with PHP dark-slide; bumped independently on npm. */
export const VERSION = "0.5.2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function toU8(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function makeWriter(options: WriteOptions = {}): PptxWriter {
  return new PptxWriter(options.tempDir ?? null, options.allowHttpImages ?? false);
}

function assertValid(deck: Any): void {
  const errors = new Validator().validate(deck);
  if (errors.length > 0) {
    throw new SchemaException(
      "Deck failed schema validation. Call Agent::validateAndRepair() for a recoverable form.",
      errors,
    );
  }
}

export const Agent = {
  /** Validate a deck without writing. Empty array = valid. */
  validate(deck: Any): ValidationError[] {
    return new Validator().validate(deck);
  },

  /**
   * Validate + apply heuristic repairs. Returns `{ ok, schema, errors }` where
   * `ok` is true when the (possibly repaired) deck validates clean.
   */
  validateAndRepair(deck: Any): RepairResult {
    const errors = this.validate(deck);
    if (errors.length === 0) {
      return { ok: true, schema: deck, errors: [] };
    }
    const repaired = new Repairer().repair(deck);
    const remaining = this.validate(repaired);

    return {
      ok: remaining.length === 0,
      schema: repaired,
      errors: remaining,
    };
  },

  /** PPTX bytes for a deck (no temp file). Universal. Throws SchemaException if invalid. */
  toBytes(deck: Any, options: WriteOptions = {}): Uint8Array {
    assertValid(deck);
    return makeWriter(options).toBytes(deck);
  },

  /** Write a deck to disk as a PPTX file (Node only). Throws SchemaException if invalid. */
  async write(deck: Any, path: string, options: WriteOptions = {}): Promise<WriteResult> {
    assertValid(deck);
    const bytes = makeWriter(options).toBytes(deck);
    const fs = await import("node:fs");
    fs.writeFileSync(path, bytes);
    return { path, bytes: bytes.length, slides: deck?.slides?.length ?? 0 };
  },

  /** Read PPTX bytes back into the Deck schema. Universal. */
  read(input: Uint8Array | ArrayBuffer): Record<string, unknown> {
    return new PptxReader().read(toU8(input));
  },

  /** Alias for {@see read}. */
  fromBytes(input: Uint8Array | ArrayBuffer): Record<string, unknown> {
    return new PptxReader().read(toU8(input));
  },

  /** Plain-text summary of a deck. Mirrors PHP `Agent::describe`. */
  describe(deck: Any): string {
    const title = String(deck?.title ?? "Untitled");
    const themeName = String(deck?.theme?.name ?? Schema.DEFAULT_THEME_NAME);
    const slides: Any[] = deck?.slides ?? [];
    const slideCount = slides.length;

    const elementCounts: Record<string, number> = {};
    for (const slide of slides) {
      for (const element of slide?.elements ?? []) {
        const type = String(element?.type ?? "unknown");
        elementCounts[type] = (elementCounts[type] ?? 0) + 1;
      }
    }

    const lines = [`Deck: ${title}`, `Theme: ${themeName}`, `Slides: ${slideCount}`];
    const keys = Object.keys(elementCounts);
    if (keys.length > 0) {
      const parts = keys.map((type) => `${elementCounts[type]} ${type}`);
      lines.push("Elements: " + parts.join(", "));
    }

    return lines.join("\n");
  },

  /** JSON Schema export for LLM tool-use registration. */
  jsonSchema(): Record<string, unknown> {
    return Schema.jsonSchema();
  },

  version(): string {
    return VERSION;
  },
};
