import { describe, it, expect } from "vitest";
import { Agent, unzipSync } from "../src";
import { TableResolver } from "../src/table/table-resolver";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/**
 * What shape a table's `rows` take, and whether the published schema says so.
 *
 * A `table` exported as `columns: {type: "array"}, rows: {type: "array"}` and
 * nothing more, while the real contract was `columns: [{key, label}]` with rows
 * as OBJECTS keyed by each column's `key` — readable only from the resolver's
 * source, so a vocabulary generated from the schema could not carry it. The
 * natural guess from a bare column list is a positional row.
 *
 * That guess failed SILENTLY, and differently per engine, which is why this file
 * pins behaviour and not only the schema text:
 *
 *   - PHP kept the row and emitted every cell empty;
 *   - THIS engine and Python dropped the row from the deck entirely, because
 *     `isPlainObject([...])` is false and the loop simply `continue`d.
 *
 * Three engines held to byte-identical OOXML disagreed on the ROW COUNT of the
 * same input, and no conformance case covered it. Reported as fancy-slides#14.
 */

const elementProps = (): Any =>
  (Agent.jsonSchema() as Any).properties.slides.items.properties.elements.items.properties;

function slideXml(rows: Any[]): string {
  const bytes = Agent.toBytes({
    id: "trs",
    title: "Table row shape",
    theme: { name: "default" },
    slides: [
      {
        id: "s1",
        elements: [
          {
            id: "t",
            type: "table",
            x: 0.1,
            y: 0.1,
            w: 0.8,
            h: 0.4,
            columns: [
              { key: "plan", label: "Plan" },
              { key: "price", label: "Monthly price" },
            ],
            rows,
          },
        ],
      },
    ],
  });

  return new TextDecoder().decode(unzipSync(bytes)["ppt/slides/slide1.xml"]!);
}

describe("the published item shape", () => {
  it("publishes the item shape of a column, not just that columns is an array", () => {
    const columns = elementProps().columns;

    expect(columns.type).toBe("array");
    expect(columns.items).toBeDefined();
    expect(Object.keys(columns.items.properties)).toContain("key");
    expect(Object.keys(columns.items.properties)).toContain("label");
    expect(columns.items.required).toContain("key");

    // `key` is the half that cannot be guessed: it is what a row is keyed BY.
    expect(columns.items.properties.key.description.toLowerCase()).toContain("row");
  });

  it("publishes the item shape of a row, including that it is keyed by the column key", () => {
    const rows = elementProps().rows;

    expect(rows.type).toBe("array");
    expect(rows.items).toBeDefined();

    // Both accepted forms are described: describing only the canonical one
    // leaves the other reading as invalid when it is not.
    const described = JSON.stringify(rows.items).toLowerCase();
    expect(described).toContain("key");
    expect(described).toContain("column order");
  });
});

describe("how a row is read", () => {
  it("renders a keyed row — the form the schema calls canonical", () => {
    const xml = slideXml([{ plan: "Starter", price: "$49" }]);

    expect(xml).toContain("Starter");
    expect(xml).toContain("$49");
  });

  it("fills a positional row by column order instead of dropping it", () => {
    const xml = slideXml([["Starter", "$49"]]);

    expect(xml).toContain("Starter");
    expect(xml).toContain("$49");
  });

  it("emits a positional row identically to the keyed row it means", () => {
    expect(slideXml([["Starter", "$49"]])).toBe(slideXml([{ plan: "Starter", price: "$49" }]));
  });

  it("reads a positional list inside `cells` by column order too", () => {
    const xml = slideXml([{ cells: ["Starter", "$49"], height: 44 }]);

    expect(xml).toContain("Starter");
    expect(xml).toContain("$49");
  });

  it("keeps a short positional row short rather than wrapping onto the next column", () => {
    const xml = slideXml([["Starter"]]);

    expect(xml).toContain("Starter");
    expect(xml.split("Starter").length - 1).toBe(1);
  });

  it("resolves a positional row through the resolver, not only through the writer", () => {
    const element = {
      type: "table",
      w: 0.8,
      columns: [{ key: "plan" }, { key: "price" }],
      rows: [["Starter", "$49"]],
    };
    const table = TableResolver.resolve(element, {});

    // Header + one body row. A dropped row leaves only the header, which is the
    // divergence this case exists to catch.
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1].cells.map((c: Any) => c.text)).toEqual(["Starter", "$49"]);
  });
});

describe("a row no shape can rescue", () => {
  const deck = (rows: Any[]): Any => ({
    id: "trs",
    title: "Table row shape",
    theme: { name: "default" },
    slides: [
      {
        id: "s1",
        elements: [
          {
            id: "t",
            type: "table",
            x: 0.1,
            y: 0.1,
            w: 0.8,
            h: 0.4,
            columns: [
              { key: "plan", label: "Plan" },
              { key: "price", label: "Price" },
            ],
            rows,
          },
        ],
      },
    ],
  });

  it("flags a row whose keys match no column", () => {
    // `Plan` is not `plan`. Every cell resolves to nothing and the table still
    // draws at full size — the blank grid the positional fallback cannot catch,
    // because this row IS an object.
    const errors = Agent.validate(deck([{ Plan: "Starter" }]));
    const paths = errors.map((e: Any) => e.path);

    expect(paths).toContain("/slides/0/elements/0/rows/0");
    expect(errors.find((e: Any) => e.path === "/slides/0/elements/0/rows/0")!.hint).toContain("plan");
  });

  it("does not flag a partial row, a positional row, or a styled row", () => {
    expect(
      Agent.validate(deck([{ plan: "Starter" }, ["Starter", "$49"], { cells: { plan: "Pro" } }, { height: 44 }])),
    ).toEqual([]);
  });
});
