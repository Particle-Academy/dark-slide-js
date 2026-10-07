import { describe, it, expect } from "vitest";
import { formatSummary, loadSuite, runTable, suiteVersion } from "@particle-academy/fancy-conformance";
import { Emu } from "../../src/helpers/emu";
import { TableResolver } from "../../src/table/table-resolver";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/**
 * Run the shared `dark-slide/table-cell-model` fixtures against THIS engine.
 *
 * The suite's manifest has named three implementations since 0.7.0 — php, node,
 * python — and until now **only python actually ran it**. A shared suite one
 * engine executes is a claim about three, checked on one: the declaration reads
 * as coverage while the other two are untested. It is the same shape as the
 * defects this family keeps finding, applied to the thing meant to find them.
 *
 * What it adds over byte parity, which already compares every OOXML part of a
 * nine-slide reference deck against the PHP engine: that deck walks exactly ONE
 * path through the resolution chain per cell. A port that collapsed two
 * precedence layers — letting the header band beat a column's own alignment,
 * say — would emit identical bytes for it and be wrong for every deck taking
 * another order. These rows walk the chain one layer at a time and each fails
 * BY NAME.
 *
 * The goldens are the output of running the PHP reference. Nothing here
 * restates them.
 */
const SUITE = "dark-slide/table-cell-model";

/** Project a resolved cell onto the suite's run shape: integers-as-strings, no floats. */
function shape(cell: Any): Any {
  const borders: Any = {};
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const spec = cell.borders[side];
    borders[side] =
      spec === null
        ? null
        : { widthEmu: String(Emu.fromPt(spec.width)), color: spec.color, style: spec.style };
  }

  const padding: Any = {};
  for (const side of ["left", "right", "top", "bottom"] as const) {
    padding[side] = String(Emu.fromPt(cell.padding[side]));
  }

  return {
    text: cell.text,
    bold: cell.bold ? "1" : "0",
    italic: cell.italic ? "1" : "0",
    underline: cell.underline ? "1" : "0",
    color: cell.color,
    fill: cell.fill,
    align: cell.align,
    anchor: cell.anchor,
    fontSizeHundredths: String(Emu.hundredthsOfPoint(cell.fontSize)),
    letterSpacingHundredths: String(Emu.hundredthsOfPoint(cell.letterSpacing)),
    caps: cell.caps,
    padding,
    borders,
    colSpan: String(cell.colSpan),
    rowSpan: String(cell.rowSpan),
    merged: cell.merged,
  };
}

function run(c: Any): unknown {
  const input = c.input;
  const table = TableResolver.resolve(input.element, input.theme ?? {});

  if (c.fn === "gridWidthsEmu") {
    return TableResolver.columnWidthsEmu(table.columns, Number(input.totalEmu)).map(String);
  }

  return shape(table.rows[input.row]!.cells[input.col]);
}

describe("the shared table-cell model", () => {
  it("has rows to run", () => {
    // A renamed or moved suite would otherwise make this file silently vacuous.
    const rows = loadSuite(SUITE).cases;

    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect([...new Set(rows.map((c: Any) => c.fn))].sort()).toEqual(["gridWidthsEmu", "resolvedCell"]);
  });

  it("resolves every cell the shared table pins", () => {
    const summary = runTable(SUITE, run, { language: "node" });

    // Printed unconditionally: a bare "3 skipped" reads identically to full
    // coverage at a glance, which is how a suite stops meaning anything without
    // anyone deciding that it should.
    console.log("\n" + formatSummary(summary));

    expect(summary.ok, formatSummary(summary)).toBe(true);
    expect(summary.passed).toBeGreaterThanOrEqual(20);
  });

  it("runs the fixture version this engine pins", () => {
    // The pin moves deliberately, with the suites re-run. A floating fixture set
    // turns a red here into "someone else changed something", which is the
    // reading that gets a failure ignored.
    expect(suiteVersion()).toBe("0.34.0");
  });
});
