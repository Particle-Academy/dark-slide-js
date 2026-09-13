import { describe, expect, it } from "vitest";
import { isNumeric } from "../src/util";

/**
 * `isNumeric` answers exactly what PHP 8's `is_numeric` answers.
 *
 * Every row below is what PHP 8.4.20 returned for that input, not what it ought
 * to return. The engine uses `isNumeric` wherever PHP uses `is_numeric` (a shape
 * radius, a style length, validator type checks), so a disagreement is a deck
 * the three engines draw differently: `"12 "` was 12 in PHP and Python and fell
 * back to a default here.
 */
const PHP_8_4_20: Array<[string, boolean]> = [
  [" 12 ", true],
  ["12 ", true],
  [" 12", true],
  ["12\n", true],
  ["\t12", true],
  ["12\v", true],
  ["12\f", true],
  ["\u00a012", false], // a non-breaking space is not PHP whitespace
  ["1e5", true],
  [".5", true],
  ["5.", true],
  ["0x1A", false],
  [" ", false],
  ["", false],
  ["1 2", false],
  ["+.5e-3 ", true],
  ["-0", true],
  ["1e", false],
  ["e5", false],
  ["1.2.3", false],
  ["١٢", false], // Arabic-Indic digits are not ASCII digits
];

describe("isNumeric matches PHP 8's is_numeric", () => {
  for (const [input, expected] of PHP_8_4_20) {
    it(`${JSON.stringify(input)} is ${expected ? "" : "not "}numeric`, () => {
      expect(isNumeric(input)).toBe(expected);
    });
  }

  it("treats finite numbers as numeric and nothing else that is not a string", () => {
    expect(isNumeric(12)).toBe(true);
    expect(isNumeric(Number.NaN)).toBe(false);
    expect(isNumeric(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isNumeric(true)).toBe(false);
    expect(isNumeric(null)).toBe(false);
  });
});
