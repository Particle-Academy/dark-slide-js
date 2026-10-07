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
      // `categories` is deliberately NOT described: this engine honours it
      // standalone while PHP and Python read it only alongside an `xAxis`
      // without `data`. Publishing a key three engines disagree on would make
      // the schema false somewhere.
      if (key === "categories") {
        expect(described).not.toHaveProperty("categories");
        continue;
      }
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

describe("the three-way split on `categories`", () => {
  it("pins that THIS engine honours a standalone `categories`, where PHP and Python do not", () => {
    // Measured 2026-10-07. This engine seeds its candidates with `null`, so the
    // `categories` fallback fires; PHP and Python seed `[]`, which is already an
    // array, so theirs never does. A chart authored that way gets real labels
    // here and 1, 2, 3 ... there, silently, and the reference deck carries no
    // chart so byte parity has never seen it.
    //
    // Pinned rather than fixed: resolving it changes the rendered output of
    // existing decks, which is the owner's call. When it is made, this fails in
    // whichever engine moves, which is exactly what should happen.
    const spec = ChartTranslator.translate({
      categories: ["Q1", "Q2"],
      series: [{ type: "bar", data: [1, 2] }],
    });

    expect(spec!.categories).toEqual(["Q1", "Q2"]);

    // And the form that IS portable, published in the schema, works here too.
    const portable = ChartTranslator.translate({
      xAxis: { data: ["Q1", "Q2"] },
      series: [{ type: "bar", data: [1, 2] }],
    });

    expect(portable!.categories).toEqual(["Q1", "Q2"]);
  });
});
