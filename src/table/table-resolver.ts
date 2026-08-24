/**
 * Turns a loose agent-authored `table` element into a fully-resolved table,
 * where every cell already carries every decision. Mirrors PHP
 * `Table\TableResolver` — including its resolution ORDER, because the two
 * engines are held to byte-identical OOXML.
 *
 * The resolved shape is expressed in POINTS and 6-digit hex, never EMU, so it
 * is document-format-neutral: `last-word` (docx) needs the same decisions and
 * renders them as `w:tcBorders` / `w:tcMar` / `w:vAlign` / `w:gridSpan`. The
 * shared contract between the two packages is THIS MODEL, not the XML, and it
 * is pinned as a cross-language table in `fancy-conformance`
 * (`shared/table-cell-control`).
 *
 * Precedence, which is the whole design:
 *
 *     cell > row > column > band (header|stripe|body) > table > theme > default
 *
 * A key that is ABSENT falls through. A key present with the value `false`
 * stops the chain and means "off" — which is why this code tests key presence
 * rather than truthiness in the places it does.
 */
import { Color } from "../helpers/color";
import { isNumeric, isPlainObject } from "../util";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export const DEFAULT_FONT_SIZE = 28;
export const DEFAULT_BODY_COLOR = "#0F172A";
export const DEFAULT_HEADER_COLOR = "#FFFFFF";
export const DEFAULT_ACCENT = "#8B5CF6";
export const DEFAULT_STRIPE_FILL = "#F8FAFC";
export const DEFAULT_BORDER_COLOR = "#D9DEE4";
export const DEFAULT_BORDER_WIDTH = 0.75;
export const DEFAULT_PADDING_X = 7.2;
export const DEFAULT_PADDING_Y = 3.6;
export const DEFAULT_HEADER_HEIGHT = 40;
export const DEFAULT_BODY_HEIGHT = 30;

export interface ResolvedBorder {
  width: number;
  color: string;
  style: string;
}

export interface ResolvedCell {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  fill: string | null;
  align: string;
  anchor: string;
  fontSize: number;
  letterSpacing: number;
  caps: string;
  fontFamily: string | null;
  padding: { left: number; right: number; top: number; bottom: number };
  borders: { left: ResolvedBorder | null; right: ResolvedBorder | null; top: ResolvedBorder | null; bottom: ResolvedBorder | null };
  colSpan: number;
  rowSpan: number;
  merged: string;
}

export interface ResolvedColumn {
  key: string;
  label: string;
  width: number | null;
  align: string | null;
  anchor: string | null;
  widthFrac: number;
}

export interface ResolvedRow {
  header: boolean;
  height: number;
  cells: ResolvedCell[];
}

export interface ResolvedTable {
  columns: ResolvedColumn[];
  rows: ResolvedRow[];
  hasHeader: boolean;
}

const STYLE_KEYS = [
  "fill", "color", "bold", "italic", "underline", "align", "anchor",
  "fontSize", "letterSpacing", "caps", "fontFamily", "padding", "borders",
] as const;

const CELL_SPEC_KEYS = [
  "text", "colSpan", "rowSpan", "fill", "color", "bold", "italic", "underline",
  "align", "anchor", "fontSize", "letterSpacing", "caps", "fontFamily", "padding", "borders",
];

export const TableResolver = {
  DEFAULT_FONT_SIZE,
  DEFAULT_BORDER_WIDTH,
  DEFAULT_BORDER_COLOR,

  resolve(element: Any, theme: Any = {}): ResolvedTable {
    const columns = normalizeColumns(Array.isArray(element?.columns) ? element.columns : []);
    const rawRows: Any[] = Array.isArray(element?.rows) ? element.rows : [];
    const style: Any = isPlainObject(element?.style) ? element.style : {};

    const accent = themeColor(theme, "accent", DEFAULT_ACCENT);

    const headerSpec = style.header ?? [];
    const hasHeader = headerSpec !== false;
    const headerStyle: Any = isPlainObject(headerSpec) ? headerSpec : {};

    const bodyStyle: Any = isPlainObject(style.body) ? style.body : {};

    const stripeSpec = style.stripe ?? [];
    const stripeOn = stripeSpec !== false;
    const stripeStyle: Any = isPlainObject(stripeSpec) ? stripeSpec : {};

    const tableDefaults: Any = {
      color: DEFAULT_BODY_COLOR,
      align: "left",
      anchor: "middle",
      fontSize: DEFAULT_FONT_SIZE,
    };
    const tableStyle = styleKeys(style);

    const grid = buildGrid(columns, rawRows, hasHeader);

    const rows: ResolvedRow[] = [];
    const rowCount = grid.length;

    grid.forEach((gridRow, r) => {
      const isHeader = hasHeader && r === 0;
      const rowSource: Any = gridRow.source;
      const rowStyle = styleKeys(rowSource);

      let bandStyle: Any = isHeader
        ? { fill: accent, color: DEFAULT_HEADER_COLOR, bold: true, ...headerStyle }
        : bodyStyle;

      // Striping is counted over BODY rows only, and the first body row is
      // never striped — which is what the writer did before this existed.
      if (!isHeader && stripeOn) {
        const bodyIndex = hasHeader ? r - 1 : r;
        if (bodyIndex % 2 === 1) {
          bandStyle = { ...bandStyle, fill: DEFAULT_STRIPE_FILL, ...stripeStyle };
        }
      }

      const cells: ResolvedCell[] = gridRow.cells.map((slot, c) =>
        resolveCell(
          slot,
          [tableDefaults, tableStyle, bandStyle, styleKeys(columns[c]!), rowStyle],
          {
            firstRow: r === 0,
            lastRow: r === rowCount - 1,
            firstCol: c === 0,
            lastCol: c === columns.length - 1,
          },
        ),
      );

      rows.push({
        header: isHeader,
        height: rowHeight(rowSource, bandStyle, tableStyle, isHeader),
        cells,
      });
    });

    return { columns, rows, hasHeader };
  },

  normalizeColumns,
  columnWidthsEmu,
};

// ─── Columns ────────────────────────────────────────────────────────────────

/**
 * Normalise the column list, resolving widths to fractions that sum to 1.
 *
 * Two modes, chosen by the values themselves: every declared width <= 1 makes
 * them FRACTIONS of the table (columns without one share what is left over);
 * any declared width > 1 makes them WEIGHTS (columns without one weigh 1). No
 * width anywhere is an equal split, which is what the writer did before widths
 * were reachable at all.
 */
function normalizeColumns(raw: Any[]): ResolvedColumn[] {
  const columns: ResolvedColumn[] = raw.map((col: Any, i: number) => {
    const c: Any = isPlainObject(col) ? col : { key: String(col) };
    return {
      key: String(c.key ?? `col${i}`),
      label: String(c.label ?? c.key ?? ""),
      width: isNumeric(c.width) && Number(c.width) > 0 ? Number(c.width) : null,
      align: c.align ?? null,
      anchor: c.anchor ?? null,
      widthFrac: 0,
    };
  });

  const n = columns.length;
  if (n === 0) return [];

  const declared = columns.map((c) => c.width).filter((w): w is number => w !== null);

  if (declared.length === 0) {
    columns.forEach((c) => (c.widthFrac = 1 / n));
    return columns;
  }

  const asFractions = Math.max(...declared) <= 1.0;
  const undeclared = n - declared.length;

  let weights: number[];
  if (asFractions) {
    const remaining = Math.max(0, 1 - declared.reduce((a, b) => a + b, 0));
    const share = undeclared > 0 ? remaining / undeclared : 0;
    weights = columns.map((c) => c.width ?? share);
  } else {
    weights = columns.map((c) => c.width ?? 1.0);
  }

  const total = weights.reduce((a, b) => a + b, 0);
  columns.forEach((c, i) => (c.widthFrac = total > 0 ? weights[i]! / total : 1 / n));

  return columns;
}

/**
 * Column widths in EMU that sum EXACTLY to the table width.
 *
 * Rounding each fraction independently loses or gains a few EMU and leaves the
 * grid a hair narrower or wider than the frame; accumulating and differencing
 * cannot.
 */
function columnWidthsEmu(columns: ResolvedColumn[], totalEmu: number): number[] {
  const out: number[] = [];
  let cum = 0;
  let prev = 0;
  for (const col of columns) {
    cum += col.widthFrac;
    const edge = Math.round(cum * totalEmu);
    out.push(edge - prev);
    prev = edge;
  }
  return out;
}

// ─── The grid ───────────────────────────────────────────────────────────────

interface Slot {
  spec: Any;
  merged: string;
  colSpan: number;
  rowSpan: number;
}

/**
 * Lay every row out as exactly columns.length slots, marking the ones a span
 * swallows. Spans are clamped to the grid: a `colSpan` of 99 on a two-column
 * table is a 2, never a row with 99 cells in it.
 */
function buildGrid(columns: ResolvedColumn[], rawRows: Any[], hasHeader: boolean): { source: Any; cells: Slot[] }[] {
  const n = columns.length;
  const grid: { source: Any; cells: Slot[] }[] = [];

  if (hasHeader) {
    grid.push({
      source: {},
      cells: columns.map((col) => ({ spec: { text: col.label }, merged: "none", colSpan: 1, rowSpan: 1 })),
    });
  }

  for (const row of rawRows) {
    if (!isPlainObject(row)) continue;
    const cellMap: Any = isPlainObject(row.cells) ? row.cells : row;
    grid.push({
      source: row,
      cells: columns.map((col) => ({
        spec: cellSpec(cellMap[col.key]),
        merged: "none",
        colSpan: 1,
        rowSpan: 1,
      })),
    });
  }

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r]!.cells[c]!.merged !== "none") continue;
      const spec = grid[r]!.cells[c]!.spec;
      const colSpan = clampSpan(spec.colSpan, n - c);
      const rowSpan = clampSpan(spec.rowSpan, grid.length - r);

      grid[r]!.cells[c]!.colSpan = colSpan;
      grid[r]!.cells[c]!.rowSpan = rowSpan;

      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) {
          if (dr === 0 && dc === 0) continue;
          const covered = dc > 0 && dr > 0 ? "both" : dc > 0 ? "horizontal" : "vertical";
          grid[r + dr]!.cells[c + dc]!.merged = covered;
          grid[r + dr]!.cells[c + dc]!.spec = { text: "" };
        }
      }
    }
  }

  return grid;
}

function clampSpan(span: Any, available: number): number {
  const s = isNumeric(span) ? Math.trunc(Number(span)) : 1;
  return Math.max(1, Math.min(s, Math.max(1, available)));
}

/**
 * A cell value is either a scalar or a spec object.
 *
 * BEHAVIOUR CHANGE: an object used to be JSON-stringified into the cell text.
 * Anything carrying none of the spec keys still is, so a genuine nested value
 * an agent meant to display is not silently emptied.
 */
function cellSpec(value: Any): Any {
  if (isPlainObject(value)) {
    if (CELL_SPEC_KEYS.some((k) => k in value)) {
      return { ...value, text: scalarText(value.text ?? "") };
    }
    return { text: JSON.stringify(value) };
  }
  if (Array.isArray(value)) return { text: JSON.stringify(value) };
  return { text: scalarText(value) };
}

function scalarText(value: Any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "1" : "";
  if (typeof value === "number" || typeof value === "string") return String(value);
  return JSON.stringify(value);
}

// ─── One cell ───────────────────────────────────────────────────────────────

function resolveCell(slot: Slot, chain: Any[], edges: Record<string, boolean>): ResolvedCell {
  const spec = slot.spec;
  const layers = [...chain, styleKeys(spec)];

  const resolved: Any = {};
  for (const layer of layers) {
    for (const k of Object.keys(layer)) resolved[k] = layer[k];
  }

  const fill = resolved.fill ?? null;

  return {
    text: String(spec.text ?? ""),
    bold: Boolean(resolved.bold ?? false),
    italic: Boolean(resolved.italic ?? false),
    underline: Boolean(resolved.underline ?? false),
    color: hex(resolved.color ?? DEFAULT_BODY_COLOR, "0F172A"),
    fill: fill === false || fill === null || fill === "none" ? null : hex(fill, "FFFFFF"),
    align: alignOf(resolved.align ?? "left"),
    anchor: anchorOf(resolved.anchor ?? "middle"),
    fontSize: Math.max(1, Number(resolved.fontSize ?? DEFAULT_FONT_SIZE) / 2),
    letterSpacing: Number(resolved.letterSpacing ?? 0),
    caps: capsOf(resolved.caps ?? "none"),
    fontFamily: resolved.fontFamily !== undefined && resolved.fontFamily !== null ? String(resolved.fontFamily) : null,
    padding: resolvePadding(resolved.padding ?? null),
    borders: resolveBorders(layers, edges),
    colSpan: slot.colSpan,
    rowSpan: slot.rowSpan,
    merged: slot.merged,
  };
}

/**
 * Per-side border resolution. The whole point of the module, and the part
 * `last-word` needs identically.
 */
function resolveBorders(layers: Any[], edges: Record<string, boolean>): ResolvedCell["borders"] {
  const sides: [keyof ResolvedCell["borders"], string][] = [
    ["left", "firstCol"],
    ["right", "lastCol"],
    ["top", "firstRow"],
    ["bottom", "lastRow"],
  ];

  const out: Any = {};

  for (const [side, edgeKey] of sides) {
    const isOuter = edges[edgeKey]!;
    let value: Any = { width: DEFAULT_BORDER_WIDTH, color: DEFAULT_BORDER_COLOR };

    for (const layer of layers) {
      if (!("borders" in layer)) continue;
      const spec = layer.borders;

      if (spec === false || spec === null || spec === "none") {
        value = null;
        continue;
      }
      if (!isPlainObject(spec)) continue;
      if (spec.none) {
        value = null;
        continue;
      }

      // A bare {width,color,style} means all four sides.
      if (spec.width !== undefined || spec.color !== undefined || spec.style !== undefined) {
        value = spec;
      }
      if ("all" in spec) value = spec.all;
      const band = isOuter ? "outer" : "inner";
      if (band in spec) value = spec[band];
      if (side in spec) value = spec[side];
    }

    out[side] = borderSide(value);
  }

  return out;
}

function borderSide(value: Any): ResolvedBorder | null {
  if (value === false || value === null || value === undefined || value === "none") return null;
  if (!isPlainObject(value)) return null;

  const width = isNumeric(value.width) ? Number(value.width) : DEFAULT_BORDER_WIDTH;
  if (width <= 0) return null;

  const style = String(value.style ?? "solid");

  return {
    width,
    color: hex(value.color ?? DEFAULT_BORDER_COLOR, "D9DEE4"),
    style: ["solid", "dash", "dot"].includes(style) ? style : "solid",
  };
}

function resolvePadding(padding: Any): ResolvedCell["padding"] {
  const out = {
    left: DEFAULT_PADDING_X,
    right: DEFAULT_PADDING_X,
    top: DEFAULT_PADDING_Y,
    bottom: DEFAULT_PADDING_Y,
  };

  if (isNumeric(padding)) {
    const v = Number(padding);
    return { left: v, right: v, top: v, bottom: v };
  }
  if (isPlainObject(padding)) {
    for (const side of ["left", "right", "top", "bottom"] as const) {
      if (isNumeric(padding[side])) out[side] = Number(padding[side]);
    }
  }

  return out;
}

// ─── Bands + defaults ───────────────────────────────────────────────────────

/**
 * The style keys a layer may contribute. Filtering by an allow-list keeps a
 * row's `cells` / `height` (and a column's `key` / `label`) from leaking into a
 * cell's resolved style.
 */
function styleKeys(source: Any): Any {
  const out: Any = {};
  if (!isPlainObject(source)) return out;
  for (const k of STYLE_KEYS) {
    if (k in source && source[k] !== null && source[k] !== undefined) out[k] = source[k];
  }
  return out;
}

function rowHeight(rowSource: Any, bandStyle: Any, tableStyle: Any, isHeader: boolean): number {
  for (const candidate of [rowSource?.height, bandStyle?.height, tableStyle?.rowHeight]) {
    if (isNumeric(candidate)) return Number(candidate);
  }
  return isHeader ? DEFAULT_HEADER_HEIGHT : DEFAULT_BODY_HEIGHT;
}

// ─── Small coercions ────────────────────────────────────────────────────────

function themeColor(theme: Any, key: string, fallback: string): string {
  const colors: Any = isPlainObject(theme?.colors) ? theme.colors : {};
  const value = colors[key];
  return typeof value === "string" && value !== "" ? value : fallback;
}

function hex(value: Any, fallback: string): string {
  return Color.parse(typeof value === "string" ? value : null, fallback)[0];
}

function alignOf(value: Any): string {
  switch (String(value)) {
    case "center":
    case "centre":
      return "center";
    case "right":
      return "right";
    case "justify":
      return "justify";
    default:
      return "left";
  }
}

function anchorOf(value: Any): string {
  switch (String(value)) {
    case "top":
      return "top";
    case "bottom":
      return "bottom";
    default:
      return "middle";
  }
}

function capsOf(value: Any): string {
  switch (String(value)) {
    case "small":
      return "small";
    case "all":
    case "upper":
      return "all";
    default:
      return "none";
  }
}
