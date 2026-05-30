import { isNumeric, isPlainObject } from "../util";

type Any = any;

export interface ChartSeries {
  type: string;
  name: string;
  values: number[];
  smooth: boolean;
  area: boolean;
  points: { x: number; y: number }[];
}
export interface ChartSpec {
  kind: string;
  title: string;
  categories: string[];
  series: ChartSeries[];
}

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

    return { kind, title: extractTitle(option), categories, series };
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
  return { type, name, values, smooth: !!raw.smooth, area, points };
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
