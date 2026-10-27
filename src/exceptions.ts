import type { ValidationError } from "./schema/types";

/** Archive refusal without document names or content in the message. */
export class ArchiveRefused extends Error {
  constructor(public readonly reason: string) {
    super(`Source archive refused: ${reason}`);
    this.name = "ArchiveRefused";
    Object.setPrototypeOf(this, ArchiveRefused.prototype);
  }
}

const TEMPLATE_MESSAGES: Record<string, string> = {
  macro_enabled: "Macro-enabled templates (.potm) are refused: re-save it as a .potx in PowerPoint.",
  family_mismatch: "This package declares a template of a different kind than its contents.",
  already_template: "This package is already a template.",
  already_document: "This package is already a document.",
  not_convertible: "This package has no single PowerPoint content-type declaration that can be rewritten (OpenDocument presentations are not read by dark-slide).",
  bad_target: 'The conversion target must be "document" or "template".',
};

/**
 * An Office template package refused, with a constant `reason`. Mirrors PHP
 * `OfficeTemplateRefused`:
 *
 * - `macro_enabled`   a .potm (or a template carrying a VBA project). Never read
 *                     and never converted.
 * - `family_mismatch` it declares a template of another family, or its parts
 *                     are not the family it declares.
 * - `already_template` / `already_document`  conversion asked for what it is.
 * - `not_convertible` there is no single declaration that can be rewritten.
 * - `bad_target`      the conversion target is not `document` or `template`.
 *
 * Branch on `reason`; the message is for people.
 */
export class OfficeTemplateRefused extends Error {
  constructor(public readonly reason: string) {
    super(`Template refused (${reason}): ${TEMPLATE_MESSAGES[reason] ?? reason}`);
    this.name = "OfficeTemplateRefused";
    Object.setPrototypeOf(this, OfficeTemplateRefused.prototype);
  }
}

/** Thrown by Agent.write/toBytes when the schema is invalid. Mirrors PHP `SchemaException`. */
export class SchemaException extends Error {
  readonly errors: ValidationError[];

  constructor(message: string, errors: ValidationError[]) {
    super(message);
    this.name = "SchemaException";
    this.errors = errors;
    Object.setPrototypeOf(this, SchemaException.prototype);
  }
}
