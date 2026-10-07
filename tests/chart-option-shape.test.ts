import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent, unzipSync } from "../src";
import { ChartTranslator } from "../src/helpers/chart-translator";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/**
 * What a chart element's `option` may contain, and whether the schema says so.
 *
 * `option` exported as `{ type: "object" }` and nothing more — the same gap as a
 * table's `columns`/`rows`, ending in the same silent failure. The React renderer
 * hands `option` straight to ECharts, which draws an EMPTY CANVAS for a shape it
 * does not recognise and raises nothing; this writer hands it to the translator,
 * which returns null for anything it cannot read and leaves a titled PLACEHOLDER.
 * Both are full-size and empty. Raised by a consumer generating their writer
 * vocabulary from this schema, in the fancy-slides#14 thread.
 *
 * Two halves, because a description is only worth publishing if it is true: every
 * option key the TRANSLATOR reads is described, found by reading the translator
 * rather than a hand list; and a chart authored as the schema describes emits a
 * native chart part rather than the placeholder.
 */
const option = (): Any =>
  (Agent.jsonSchema() as Any).properties.slides.items.properties.elements.items.properties.option;

function parts(element: Record<string, unknown>): { names: string[]; } {
  const bytes = Agent.toBytes({
    id: "cos",
    title: "Chart option",
    theme: { name: "default" },
    slides: [
      {
        id: "s1",
        elements: [{ id: "c", type: "chart", x: 0.1, y: 0.1, w: 0.8, h: 0.6, ...element }],
      },
    ],
  });

  return { names: Object.keys(unzipSync(bytes)) };
}

describe("the published chart option shape", () => {
  it("describes every option key the translator reads", () => {
    // Found by reading the translator, not by listing keys here: a key added
    // there and not described here must fail this.
    const source = readFileSync(join(__dirname, "..", "src", "helpers", "chart-translator.ts"), "utf8");
    const read = [...new Set([...source.matchAll(/option\?\.([A-Za-z]+)/g)].map((m) => m[1]!))].sort();

    // The scan has to find the keys, or the loop below proves nothing.
    expect(read).toContain("series");
    expect(read).toContain("xAxis");
    expect(read).toContain("title");

    const described = option().properties;
    for (const key of read) {

      expect(described, key).toHaveProperty(key);
      expect(described[key].description, key).not.toBe("");
    }
  });

  it("describes the series item shape, which is where a chart is actually declared", () => {
    const series = option().properties.series;

    for (const key of ["type", "name", "data", "smooth", "areaStyle"]) {
      expect(Object.keys(series.items.properties)).toContain(key);
    }
    expect(series.items.properties.type.enum).toEqual(ChartTranslator.SUPPORTED_TYPES);
  });

  it("says what happens to an option it cannot translate, since nothing else will", () => {
    const described = JSON.stringify(option()).toLowerCase();

    expect(described).toContain("placeholder");
    expect(described).toContain("image");
  });
});

describe("what the writer does with it", () => {
  it("emits a native chart part for an option authored as the schema describes", () => {
    expect(
      parts({
        option: {
          title: { text: "Revenue" },
          xAxis: { data: ["Q1", "Q2"] },
          series: [{ type: "bar", name: "ARR", data: [120, 180] }],
        },
      }).names,
    ).toContain("ppt/charts/chart1.xml");
  });

  it("falls back to a placeholder for a series type it cannot render", () => {
    // The counter-case. Without it the assertion above passes on a writer that
    // emits a chart part for everything.
    expect(parts({ option: { series: [{ type: "radar", data: [1, 2] }] } }).names).not.toContain(
      "ppt/charts/chart1.xml",
    );
  });

  it("returns null rather than throwing for an option that is not an object", () => {
    // A deck written by the PHP engine serialises an empty option as `[]`.
    expect(ChartTranslator.translate([] as Any)).toBeNull();
    expect(ChartTranslator.translate(null as Any)).toBeNull();
  });
});

describe("the chart diagnostic", () => {
  const deck = (element: Record<string, unknown>): Any => ({
    id: "cos",
    title: "Chart option",
    theme: { name: "default" },
    slides: [
      { id: "s1", elements: [{ id: "c", type: "chart", x: 0.1, y: 0.1, w: 0.8, h: 0.6, ...element }] },
    ],
  });

  it("flags a chart with no option object at all", () => {
    const errors = Agent.validate(deck({}));
    const entry = errors.find((e: Any) => e.path === "/slides/0/elements/0/option");

    expect(entry).toBeDefined();
    expect(entry!.hint).toContain("series");
  });

  it("does NOT flag an option it cannot translate, because the placeholder is supported", () => {
    // The narrowness is load-bearing: `Agent.write()` throws on any validator
    // error, so flagging this would turn a documented, tested fallback into a
    // hard failure. It did exactly that in the PHP engine while this was being
    // written, and that engine's V04 suite caught it.
    const d = deck({ option: { series: [{ type: "radar", data: [1, 2] }] } });

    expect(Agent.validate(d)).toEqual([]);
    expect(() => Agent.toBytes(d)).not.toThrow();
  });
});

describe("`categories`, now that all three engines agree", () => {
  it("honours a standalone `categories`, as it always did and the others now do", () => {
    // Was a three-way split until 2026-10-07: this engine seeded its candidates
    // `null` and honoured it, while PHP and Python seeded `[]` -- already an
    // array, so their fallback never fired and the same deck came out with
    // 1, 2, 3 ... labels. Invisible to byte parity, which never reaches the
    // translator because the reference deck carries no chart. The owner ruled
    // that the other two should match this engine.
    const spec = ChartTranslator.translate({
      categories: ["Q1", "Q2"],
      series: [{ type: "bar", data: [1, 2] }],
    });

    expect(spec!.categories).toEqual(["Q1", "Q2"]);

    // `xAxis.data` still wins where both are given: it is the ECharts key, and
    // the only one a browser renderer reads.
    const both = ChartTranslator.translate({
      categories: ["ignored", "also ignored"],
      xAxis: { data: ["Q1", "Q2"] },
      series: [{ type: "bar", data: [1, 2] }],
    });

    expect(both!.categories).toEqual(["Q1", "Q2"]);
  });
});
