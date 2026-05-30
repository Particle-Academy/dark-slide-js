/**
 * Top-level instance API mirroring PHP `DarkSlide`. Delegates to {@see Agent};
 * exists so DI consumers can hold a configured instance (tempDir /
 * allowHttpImages) with familiar instance semantics.
 */

import { Agent, VERSION } from "./agent";
import { SchemaException } from "./exceptions";
import type { RepairResult, ValidationError, WriteResult } from "./schema/types";
import { Validator } from "./schema/validator";
import { PptxWriter } from "./writer/pptx-writer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export class DarkSlide {
  static readonly VERSION = VERSION;

  constructor(
    private tempDir: string | null = null,
    private allowHttpImages = false,
  ) {}

  validate(deck: Any): ValidationError[] {
    return Agent.validate(deck);
  }

  validateAndRepair(deck: Any): RepairResult {
    return Agent.validateAndRepair(deck);
  }

  async write(deck: Any, path: string): Promise<WriteResult> {
    return Agent.write(deck, path, { tempDir: this.tempDir ?? undefined, allowHttpImages: this.allowHttpImages });
  }

  toBytes(deck: Any): Uint8Array {
    this.throwIfInvalid(deck);
    return new PptxWriter(this.tempDir, this.allowHttpImages).toBytes(deck);
  }

  private throwIfInvalid(deck: Any): void {
    const errors = new Validator().validate(deck);
    if (errors.length > 0) {
      throw new SchemaException(
        "Deck failed schema validation. Call validateAndRepair() for a recoverable form.",
        errors,
      );
    }
  }

  read(input: Uint8Array | ArrayBuffer): Record<string, unknown> {
    return Agent.read(input);
  }

  describe(deck: Any): string {
    return Agent.describe(deck);
  }

  jsonSchema(): Record<string, unknown> {
    return Agent.jsonSchema();
  }
}
