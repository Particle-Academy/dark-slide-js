import { isNumeric, isPlainObject } from "../util";

type Any = any;

export interface ChartSeries {
  type: string;
  name: string;
  values: number[];
  smooth: boolean;
  area: boolean;
  points: { x: number; y: number }[];
  /** ECharts' `label.show`: the series' values drawn on the chart. */
  labels: boolean;
  /** ECharts' series `itemStyle.color`, upper-case hex without '#'. */
  color: string | null;
  /** Points with an `itemStyle.color` of their own. */
  pointColors: { index: number; color: string }[];
}
export interface ChartSpec {
  kind: string;
  title: string;
  categories: string[];
  series: ChartSeries[];
  /** Only when `option.legend` is set and not switched off, as ECharts draws it. */
  legend: boolean;
  /** `option.color`, ECharts' palette; [] for the default. */
  palette: string[];
}

/**
 * ECharts series types we can render as native OOXML charts.
 *
 * WIDENING IS SAFE, NARROWING IS BREAKING, and not only for our own output: the
 * list is published in the deck schema as `option.series.items.type`'s enum, and a
 * consumer generating their writer vocabulary from that schema guards it — their
 * craft guidance tells authoring agents to stay inside these four, because a type
 * outside them makes the WHOLE option untranslatable and leaves a same-sized
 * placeholder box with a file still written and nothing raised. Drop one and their
 * test goes red before a writer finds out, which is the arrangement working; add
 * one and nothing breaks anywhere.
 */
const SUPPORTED_TYPES = ["bar", "line", "pie", "scatter"];

const isScalar = (v: unknown): boolean =>
  typeof v === "number" || typeof v === "string" || typeof v === "boolean";

/** ECharts option → normalised chart spec, or null. Mirrors PHP `Helpers\ChartTranslator`. */
export const ChartTranslator = {
  SUPPORTED_TYPES,

  translate(option: Any): ChartSpec | null {
    const rawSeries = extractSeries(option);
    if (rawSeries.length === 0) return null;

    let categories = extractCategories(option);
    const series: ChartSeries[] = [];
    let kind: string | null = null;

    for (const raw of rawSeries) {
      if (!isPlainObject(raw)) continue;
      const type = typeof raw.type === "string" ? raw.type.toLowerCase() : "bar";
      if (!SUPPORTED_TYPES.includes(type)) return null;

      const normalised = normaliseSeries(raw, type);
      if (normalised === null) return null;

      kind ??= type;
      series.push(normalised);

      if (type === "pie" && categories.length === 0) {
        categories = pieCategories(raw);
      }
    }

    if (series.length === 0 || kind === null) return null;

    return { kind, title: extractTitle(option), categories, series, legend: wantsLegend(option), palette: palette(option) };
  },
};

function extractSeries(option: Any): Any[] {
  const series = option?.series ?? null;
  if (Array.isArray(series)) return series;
  if (isPlainObject(series) && Object.keys(series).length > 0) return [series];
  return [];
}

function extractCategories(option: Any): string[] {
  let candidates: Any = null;
  const xAxis = option?.xAxis ?? null;
  if (Array.isArray(xAxis)) {
    candidates = isPlainObject(xAxis[0]) ? xAxis[0].data : (xAxis as Any).data;
  } else if (isPlainObject(xAxis)) {
    candidates = xAxis.data;
  }
  if (!Array.isArray(candidates)) candidates = option?.categories ?? null;
  if (!Array.isArray(candidates)) return [];

  const out: string[] = [];
  for (const value of candidates) {
    if (isScalar(value)) out.push(String(value));
  }
  return out;
}

function extractTitle(option: Any): string {
  const title = option?.title ?? null;
  if (isPlainObject(title)) {
    const text = title.text ?? title[0]?.text ?? null;
    if (typeof text === "string") return text;
  }
  if (Array.isArray(title)) {
    const text = title[0]?.text ?? null;
    if (typeof text === "string") return text;
  }
  if (typeof title === "string") return title;
  return "";
}

function normaliseSeries(raw: Any, type: string): ChartSeries | null {
  const name = isScalar(raw.name) ? String(raw.name) : "";
  const data = raw.data ?? null;
  if (!Array.isArray(data)) return null;

  const values: number[] = [];
  const points: { x: number; y: number }[] = [];
  const pointColors: { index: number; color: string }[] = [];
  data.forEach((point: Any, i: number) => {
    const pointColor = type === "scatter" ? null : itemColor(point);
    if (pointColor !== null) pointColors.push({ index: i, color: pointColor });
  });
  for (const point of data) {
    if (type === "scatter") {
      const xy = scatterPoint(point);
      if (xy !== null) points.push(xy);
      continue;
    }
    values.push(numericValue(point));
  }

  if (type === "scatter" && points.length === 0) return null;
  if (type !== "scatter" && values.length === 0) return null;

  const area = type === "line" && raw.areaStyle !== undefined;
  const labels = isPlainObject(raw.label) && raw.label.show === true;
  return { type, name, values, smooth: !!raw.smooth, area, points, labels, color: itemColor(raw), pointColors };
}

/** `option.color`, ECharts' palette. Mirrors PHP ChartTranslator::palette. */
function palette(option: Any): string[] {
  const colors = option.color;
  if (!Array.isArray(colors) && !isPlainObject(colors)) return [];
  const out: string[] = [];
  for (const color of Object.values(colors as Record<string, unknown>)) {
    const hex = hexColor(color);
    if (hex !== null) out.push(hex);
  }
  return out;
}

/** `#RRGGBB` as upper-case hex without the '#', or null. */
function hexColor(color: unknown): string | null {
  const m = typeof color === "string" ? /^#([0-9A-Fa-f]{6})$/.exec(color) : null;
  return m ? m[1]!.toUpperCase() : null;
}

/** `itemStyle.color` of a series or a data item, or null. */
function itemColor(holder: Any): string | null {
  if (!isPlainObject(holder) && !Array.isArray(holder)) return null;
  const style: Any = (holder as Any).itemStyle;
  return isPlainObject(style) || Array.isArray(style) ? hexColor((style as Any).color) : null;
}

/** Whether the chart draws a legend: only when `option.legend` is set and not switched off. */
function wantsLegend(option: Any): boolean {
  // An object OR a list, as PHP's is_array reads it: ECharts allows both.
  const legend = option.legend;
  return typeof legend === "object" && legend !== null && legend.show !== false;
}

function numericValue(point: Any): number {
  if (isNumeric(point)) return Number(point);
  if (isPlainObject(point) && isNumeric(point.value)) return Number(point.value);
  return 0;
}

function scatterPoint(point: Any): { x: number; y: number } | null {
  let pair = point;
  if (isPlainObject(point) && Array.isArray(point.value)) pair = point.value;
  if (Array.isArray(pair) && pair.length >= 2 && isNumeric(pair[0]) && isNumeric(pair[1])) {
    return { x: Number(pair[0]), y: Number(pair[1]) };
  }
  return null;
}

function pieCategories(raw: Any): string[] {
  const data = raw.data ?? null;
  if (!Array.isArray(data)) return [];
  return data.map((point: Any, i: number) =>
    isPlainObject(point) && isScalar(point.name) ? String(point.name) : `Slice ${i + 1}`,
  );
}
