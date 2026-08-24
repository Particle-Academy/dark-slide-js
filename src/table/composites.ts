/**
 * Composite elements — `kpiBand` and `metadataGrid` — as AUTHORING SUGAR.
 * Mirrors PHP `Table\Composites`.
 *
 * Each expands into an ordinary `table` element before the writer ever sees
 * it. That is deliberate, and it has three consequences worth stating because
 * a genuinely new primitive looks tempting:
 *
 *   1. No new OOXML surface. A KPI band is a two-row table with the rule
 *      between the rows switched off; a metadata grid is a label-over-value
 *      table with every rule switched off. Both were expressible the moment
 *      per-cell borders existed — the composite spares an agent the arithmetic.
 *   2. `@particle-academy/fancy-slides` keeps a schema it can render. A new
 *      element type would be a hole in the JS editor the day it shipped.
 *   3. A composite READ BACK comes back as its expansion, a `table`. Lossy in
 *      one direction, documented rather than hidden — the alternative is a
 *      reader inventing intent it cannot recover.
 */
import { isNumeric, isPlainObject } from "../util";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export const COMPOSITE_TYPES = ["kpiBand", "metadataGrid"] as const;

export const Composites = {
  TYPES: COMPOSITE_TYPES,

  isComposite(type: unknown): boolean {
    return typeof type === "string" && (COMPOSITE_TYPES as readonly string[]).includes(type);
  },

  expand(element: Any, theme: Any = {}): Any {
    switch (element?.type) {
      case "kpiBand":
        return kpiBand(element, theme);
      case "metadataGrid":
        return metadataGrid(element, theme);
      default:
        return element;
    }
  },
};

/**
 * Four big figures with a small caption under each, in one banded box.
 *
 * The figure and its caption are two table rows that must read as one cell, so
 * the rule between them is turned off from BOTH sides — a border is resolved
 * per cell, and leaving either half on draws the line.
 */
function kpiBand(element: Any, theme: Any): Any {
  const items = itemsOf(element);
  const style: Any = isPlainObject(element.style) ? element.style : {};

  const accent = themeColor(theme, "accent", "#8B5CF6");
  const fill = style.fill ?? null;
  const valueColor = style.valueColor ?? style.color ?? accent;
  const captionColor = style.captionColor ?? themeColor(theme, "muted", "#64748B");
  // Conservative on purpose: the writer has no font metrics, so it cannot know
  // a figure will fit. Four items across a full-width band at 60 wrapped
  // "$51K-$68K" onto two lines. A deck that knows its own content raises it.
  const valueSize = style.valueFontSize ?? 40;
  const captionSize = style.captionFontSize ?? 20;
  const align = style.align ?? "center";

  const columns: Any[] = [];
  const values: Any = {};
  const captions: Any = {};
  items.forEach((item, i) => {
    const key = `k${i}`;
    columns.push({ key, label: "" });
    values[key] = String(item.value ?? "");
    captions[key] = String(item.caption ?? "");
  });

  // Only the rule BETWEEN kpis, plus the band's own outline.
  const borders = style.borders ?? {
    inner: { width: 0.75, color: themeColor(theme, "muted", "#D9DEE4") },
    outer: { width: 0.75, color: themeColor(theme, "muted", "#D9DEE4") },
  };

  return {
    id: element.id ?? "kpi-band",
    type: "table",
    x: element.x ?? 0.06,
    y: element.y ?? 0.5,
    w: element.w ?? 0.88,
    h: element.h ?? 0.2,
    z: element.z ?? null,
    hidden: element.hidden ?? null,
    animation: element.animation ?? null,
    columns,
    rows: [
      {
        cells: values,
        height: style.valueHeight ?? 44,
        fontSize: valueSize,
        color: valueColor,
        bold: true,
        align,
        anchor: "bottom",
        borders: withoutSide(borders, "bottom"),
      },
      {
        cells: captions,
        height: style.captionHeight ?? 30,
        fontSize: captionSize,
        color: captionColor,
        align,
        anchor: "top",
        borders: withoutSide(borders, "top"),
      },
    ],
    style: {
      header: false,
      stripe: false,
      fill,
      padding: style.padding ?? { left: 8, right: 8, top: 2, bottom: 2 },
    },
  };
}

/**
 * A label/value metadata panel, `columns` across and as many rows down as the
 * items need. Labels are letterspaced small caps — the eyebrow treatment the
 * construct exists for.
 *
 * A short final row is PADDED to full width. A ragged row is a shorter
 * `<a:tr>` than the grid declares, which is a corrupt file rather than a
 * cosmetic problem.
 */
function metadataGrid(element: Any, theme: Any): Any {
  const items = itemsOf(element);
  const style: Any = isPlainObject(element.style) ? element.style : {};

  const across = isNumeric(element.columns) ? Math.max(1, Math.trunc(Number(element.columns))) : 3;

  const labelColor = style.labelColor ?? themeColor(theme, "muted", "#64748B");
  const valueColor = style.valueColor ?? themeColor(theme, "text", "#0F172A");
  const fill = style.fill ?? null;

  const columns: Any[] = [];
  for (let i = 0; i < across; i++) columns.push({ key: `c${i}`, label: "" });

  const rows: Any[] = [];
  for (let start = 0; start < items.length; start += across) {
    const chunk = items.slice(start, start + across);
    const labels: Any = {};
    const values: Any = {};
    for (let i = 0; i < across; i++) {
      const item: Any = isPlainObject(chunk[i]) ? chunk[i] : {};
      labels[`c${i}`] = String(item.label ?? "");
      values[`c${i}`] = String(item.value ?? "");
    }
    rows.push({
      cells: labels,
      height: style.labelHeight ?? 18,
      fontSize: style.labelFontSize ?? 18,
      color: labelColor,
      letterSpacing: style.labelLetterSpacing ?? 1.2,
      caps: "small",
      bold: true,
      anchor: "bottom",
    });
    rows.push({
      cells: values,
      height: style.valueHeight ?? 26,
      fontSize: style.valueFontSize ?? 28,
      color: valueColor,
      bold: true,
      anchor: "top",
    });
  }

  return {
    id: element.id ?? "metadata-grid",
    type: "table",
    x: element.x ?? 0.06,
    y: element.y ?? 0.5,
    w: element.w ?? 0.88,
    h: element.h ?? 0.22,
    z: element.z ?? null,
    hidden: element.hidden ?? null,
    animation: element.animation ?? null,
    columns,
    rows,
    style: {
      header: false,
      stripe: false,
      borders: style.borders ?? false,
      fill,
      padding: style.padding ?? { left: 10, right: 10, top: 2, bottom: 2 },
    },
  };
}

/** Drop one side from a border spec, so two stacked rows read as one cell. */
function withoutSide(borders: Any, side: string): Any {
  if (!isPlainObject(borders)) return borders;
  return { ...borders, [side]: false };
}

function itemsOf(element: Any): Any[] {
  const items = Array.isArray(element?.items) ? element.items : [];
  return items.filter((i: Any) => isPlainObject(i));
}

function themeColor(theme: Any, key: string, fallback: string): string {
  const colors: Any = isPlainObject(theme?.colors) ? theme.colors : {};
  const value = colors[key];
  return typeof value === "string" && value !== "" ? value : fallback;
}
