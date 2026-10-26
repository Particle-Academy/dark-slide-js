import type { ValidationError } from "./schema/types";

/** Archive refusal without document names or content in the message. */
export class ArchiveRefused extends Error {
  constructor(public readonly reason: string) {
    super(`Source archive refused: ${reason}`);
    this.name = "ArchiveRefused";
    Object.setPrototypeOf(this, ArchiveRefused.prototype);
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
