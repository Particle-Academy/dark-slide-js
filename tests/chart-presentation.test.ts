import { describe, expect, it } from "vitest";
import { unzipSync } from "../src";
import { PptxWriter } from "../src/writer/pptx-writer";

/**
 * A native chart looks like the chart fancy-slides draws from the same option:
 * a legend only when `option.legend` asks, values when a series asks with
 * `label.show`, no minor ticks. And a shape's outline takes the theme accent.
 * The same cases run in all three engines.
 */
type Any = Record<string, unknown>;

function part(deck: Any, name: string): string {
  const files = unzipSync(new PptxWriter().toBytes(deck as never));
  return new TextDecoder().decode(files[name]!);
}

function chart(option: Any): string {
  return part(
    {
      id: "cp",
      title: "Chart presentation",
      theme: { name: "cp" },
      slides: [{ id: "s1", elements: [{ id: "c", type: "chart", x: 0.1, y: 0.1, w: 0.8, h: 0.6, option }] }],
    },
    "ppt/charts/chart1.xml",
  );
}

const bars = (): Any => ({ xAxis: { data: ["North", "South", "EMEA"] }, series: [{ type: "bar", name: "Revenue", data: [1.25, 0.98, 2.1] }] });

describe("chart presentation", () => {
  it("draws no legend unless the option asks for one", () => {
    expect(chart(bars())).not.toContain("<c:legend>");
    expect(chart({ ...bars(), legend: {} })).toContain("<c:legend>");
    expect(chart({ ...bars(), legend: { show: false } })).not.toContain("<c:legend>");
  });

  it("shows values when a series asks with label.show", () => {
    const labelled = bars();
    (labelled.series as Any[])[0].label = { show: true };

    expect(chart(bars())).not.toContain("<c:dLbls>");
    expect(chart(labelled)).toContain('<c:showVal val="1"/>');
  });

  it("labels a pie and a line too", () => {
    const pie = { series: [{ type: "pie", label: { show: true }, data: [{ name: "A", value: 1 }, { name: "B", value: 2 }] }] };
    const line = { xAxis: { data: ["Q1", "Q2"] }, series: [{ type: "line", label: { show: true }, data: [1, 2] }] };

    expect(chart(pie)).toContain('<c:showVal val="1"/>');
    expect(chart(line)).toContain('<c:showVal val="1"/>');
  });

  it("draws no minor tick marks", () => {
    expect(chart(bars()).split('<c:minorTickMark val="none"/>').length - 1).toBe(2);
  });

  it("outlines a shape in the theme accent unless it names a stroke", () => {
    const deck = (shape: Any): Any => ({
      id: "cp",
      title: "Shape",
      theme: { name: "cp", colors: { accent: "#F97316" } },
      slides: [{ id: "s1", elements: [{ id: "r", type: "shape", shape: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.01, fill: "#F97316", ...shape }] }],
    });

    expect(part(deck({}), "ppt/slides/slide1.xml")).toContain('<a:ln w="9525"><a:solidFill><a:srgbClr val="F97316"');
    expect(part(deck({}), "ppt/slides/slide1.xml")).not.toContain("8B5CF6");
    expect(part(deck({ stroke: "#000000" }), "ppt/slides/slide1.xml")).toContain('<a:srgbClr val="000000"');
  });
});

/** Chart colours, as ECharts states them. Mirrors PHP tests/Unit/ChartColorsTest.php. */
describe("chart colours", () => {
  const ccBars = (): Any => ({
    xAxis: { type: "category", data: ["Leeds", "Bristol", "Glasgow", "Norwich"] },
    yAxis: { type: "value" },
    series: [{ type: "bar", itemStyle: { color: "#94A3B8" }, data: [96.1, 95.4, 93.8, { value: 90.7, itemStyle: { color: "#DC2626" } }] }],
  });

  it("colours a series and a single bar from itemStyle", () => {
    const xml = chart(ccBars());
    expect(xml).toContain('<c:spPr><a:solidFill><a:srgbClr val="94A3B8"/></a:solidFill></c:spPr>');
    expect(xml).toContain(
      '<c:dPt><c:idx val="3"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="DC2626"/></a:solidFill></c:spPr></c:dPt>',
    );
    expect(xml.indexOf("<c:dPt>")).toBeGreaterThan(xml.indexOf('val="94A3B8"'));
    expect(xml.indexOf("<c:dPt>")).toBeLessThan(xml.indexOf("<c:cat>"));
  });

  it("takes the palette from option.color", () => {
    const xml = chart({ color: ["#0F766E", "#F59E0B"], xAxis: { type: "category", data: ["A", "B"] }, series: [{ type: "bar", data: [1, 2] }, { type: "bar", data: [3, 4] }] });
    expect(xml).toContain('<a:srgbClr val="0F766E"/>');
    expect(xml).toContain('<a:srgbClr val="F59E0B"/>');
    expect(xml).not.toContain('val="EC4899"');
  });

  it("colours pie slices from the palette and from a slice of their own", () => {
    const xml = chart({
      color: ["#0F766E", "#CBD5E1"],
      series: [{ type: "pie", data: [{ name: "Cited reconciliation", value: 41, itemStyle: { color: "#C2410C" } }, { name: "Other reasons", value: 59 }] }],
    });
    expect(xml).toContain('<c:dPt><c:idx val="0"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="C2410C"/></a:solidFill></c:spPr></c:dPt>');
    expect(xml).toContain('<c:dPt><c:idx val="1"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="CBD5E1"/></a:solidFill></c:spPr></c:dPt>');
    expect(xml).not.toContain("EC4899");
  });

  it("colours a line marker for a single point", () => {
    const xml = chart({ xAxis: { type: "category", data: ["Q1", "Q2", "Q3"] }, series: [{ type: "line", data: [1, 2, { value: 3, itemStyle: { color: "#DC2626" } }] }] });
    expect(xml).toContain(
      '<c:dPt><c:idx val="2"/><c:marker><c:symbol val="circle"/><c:size val="7"/><c:spPr><a:solidFill><a:srgbClr val="DC2626"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="DC2626"/></a:solidFill></a:ln></c:spPr></c:marker><c:bubble3D val="0"/></c:dPt>',
    );
  });

  it("writes what it always did when the option names no colour", () => {
    const plain = ccBars() as { series: Any[] };
    delete plain.series[0]!.itemStyle;
    (plain.series[0]!.data as unknown[])[3] = 90.7;
    expect(chart(plain as Any)).not.toContain("<c:dPt>");
  });
});

describe("zero-based bars", () => {
  it("starts a bar axis at zero, unless a value is negative or it is a line", () => {
    expect(chart({ xAxis: { data: ["A", "B"] }, series: [{ type: "bar", data: [96.1, 90.7] }] })).toContain('<c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling>');
    expect(chart({ xAxis: { data: ["A", "B"] }, series: [{ type: "bar", data: [3, -1] }] })).not.toContain('<c:min val="0"/>');
    expect(chart({ xAxis: { data: ["A", "B"] }, series: [{ type: "line", data: [96, 91] }] })).not.toContain('<c:min val="0"/>');
  });
});
