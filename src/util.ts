/** Shared helpers mirroring PHP loose semantics. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** PHP `is_numeric` (approx): number, or numeric string with optional leading ws. */
export function isNumeric(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v !== "string") return false;
  return /^\s*[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(v);
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
