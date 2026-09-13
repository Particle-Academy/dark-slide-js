/** Shared helpers mirroring PHP loose semantics. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** PHP 8's numeric string: ASCII whitespace either side, sign, decimal, exponent. */
const PHP_NUMERIC = /^[ \t\n\r\v\f]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[ \t\n\r\v\f]*$/;

/**
 * PHP 8's `is_numeric`, exactly: a finite number, or a string with optional
 * leading AND trailing ASCII whitespace (space, tab, LF, CR, VT, FF), an optional
 * sign, and a decimal (`5`, `5.`, `.5`, `5.5`) with an optional exponent.
 *
 * It was an approximation that allowed leading whitespace only, rejected `"5."`,
 * and used `\s`, which also matches a non-breaking space PHP rejects. So `"12 "`
 * was a number in the PHP reference and the Python port and not here. The table
 * in tests/util-is-numeric.test.ts was produced by running PHP 8.4.20; the
 * Python port's `_NUMERIC` is the same pattern.
 */
export function isNumeric(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v !== "string") return false;
  return PHP_NUMERIC.test(v);
}

/** PHP `gettype`-style label used by the validator's `got` field. */
export function gettype(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "object":
      return "object";
    case "boolean":
      return "boolean";
    case "number":
      return Number.isInteger(v) ? "integer" : "double";
    case "string":
      return "string";
    default:
      return typeof v;
  }
}

/** structuredClone with JSON fallback. */
export function clone<T>(v: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(v)
    : (JSON.parse(JSON.stringify(v)) as T);
}
