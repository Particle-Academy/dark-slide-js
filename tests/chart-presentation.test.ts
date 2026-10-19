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
