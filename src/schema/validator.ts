import { gettype, isNumeric, isPlainObject } from "../util";
import { Schema } from "./schema";
import { ROW_KEYS, STYLE_KEYS, TableResolver } from "../table/table-resolver";
import type { ValidationError } from "./types";

type Any = any;

/** Liberal schema validator. Mirrors PHP `Schema\Validator`. */
export class Validator {
  validate(deck: Any): ValidationError[] {
    const errors: ValidationError[] = [];
    const d = isPlainObject(deck) ? deck : {};

    for (const key of Schema.deckRequiredKeys()) {
      if (!(key in d)) errors.push(err(`/${key}`, key, "missing", null, `Deck must have an \`${key}\` field.`));
    }

    if (d.id !== undefined && typeof d.id !== "string") {
      errors.push(err("/id", "string", gettype(d.id), d.id, "Deck id must be a string."));
    }
    if (d.title !== undefined && typeof d.title !== "string") {
      errors.push(err("/title", "string", gettype(d.title), d.title, "Deck title must be a string."));
    }

    if (d.theme !== undefined) {
      if (!isPlainObject(d.theme)) {
        errors.push(err("/theme", "object", gettype(d.theme), d.theme, "Theme must be an object with at least a `name` field."));
      } else if (d.theme.name === undefined) {
        errors.push(err("/theme/name", "string", "missing", null, "Theme must have a name."));
      }
    }

    if (d.slides !== undefined) {
      if (!Array.isArray(d.slides)) {
        errors.push(err("/slides", "array", gettype(d.slides), d.slides, "Slides must be a JSON array."));
      } else {
        d.slides.forEach((slide: Any, i: number) => {
          errors.push(...this.validateSlide(slide, `/slides/${i}`));
        });
      }
    }

    return errors;
  }

  private validateSlide(slide: Any, path: string): ValidationError[] {
    const errors: ValidationError[] = [];
    if (!isPlainObject(slide)) {
      return [err(path, "object", gettype(slide), slide, "Each slide must be a JSON object.")];
    }

    for (const key of Schema.slideRequiredKeys()) {
      if (!(key in slide)) errors.push(err(`${path}/${key}`, key, "missing", null, `Slide must have a \`${key}\` field.`));
    }

    if (slide.id !== undefined && typeof slide.id !== "string") {
      errors.push(err(`${path}/id`, "string", gettype(slide.id), slide.id, "Slide id must be a string."));
    }

    if (slide.elements !== undefined) {
      if (!Array.isArray(slide.elements)) {
        errors.push(err(`${path}/elements`, "array", gettype(slide.elements), slide.elements, "Slide elements must be an array."));
      } else {
        slide.elements.forEach((element: Any, i: number) => {
          errors.push(...this.validateElement(element, `${path}/elements/${i}`));
        });
      }
    }

    if (slide.notes !== undefined && typeof slide.notes !== "string") {
      errors.push(err(`${path}/notes`, "string", gettype(slide.notes), slide.notes, "Slide notes must be a string."));
    }

    return errors;
  }

  private validateElement(element: Any, path: string): ValidationError[] {
    const errors: ValidationError[] = [];
    if (!isPlainObject(element)) {
      return [err(path, "object", gettype(element), element, "Each element must be a JSON object.")];
    }

    for (const key of Schema.elementRequiredKeys()) {
      if (!(key in element)) errors.push(err(`${path}/${key}`, key, "missing", null, `Element must have a \`${key}\` field.`));
    }

    if (element.type !== undefined && !(Schema.ELEMENT_TYPES as readonly string[]).includes(element.type)) {
      errors.push(
        err(
          `${path}/type`,
          "one of: " + Schema.ELEMENT_TYPES.join(" / "),
          String(element.type),
          element.type,
          "Unknown element type — supported: " + Schema.ELEMENT_TYPES.join(", "),
        ),
      );
    }

    for (const coord of ["x", "y", "w", "h"] as const) {
      if (!(coord in element)) continue;
      if (!isNumeric(element[coord])) {
        errors.push(
          err(
            `${path}/${coord}`,
            "number (0..1)",
            gettype(element[coord]),
            element[coord],
            `Element ${coord} must be a number in the 0..1 range (slide-relative fraction).`,
          ),
        );
      }
    }

    if (typeof element.type === "string") {
      switch (element.type) {
        case "text":
          if (typeof element.content !== "string") {
            errors.push(err(`${path}/content`, "string", gettype(element.content ?? null), element.content ?? null, "Text element must have a `content` string."));
          }
          break;
        case "image":
          if (typeof element.src !== "string") {
            errors.push(err(`${path}/src`, "string (URL or data URI)", gettype(element.src ?? null), element.src ?? null, "Image element must have a `src` string."));
          }
          break;
        case "shape":
          if (!(Schema.SHAPE_KINDS as readonly string[]).includes(element.shape)) {
            errors.push(err(`${path}/shape`, "one of: " + Schema.SHAPE_KINDS.join(" / "), String(element.shape ?? "missing"), element.shape ?? null, "Shape element must specify a known `shape` kind."));
          }
          break;
        case "code":
          if (typeof element.code !== "string") {
            errors.push(err(`${path}/code`, "string", gettype(element.code ?? null), element.code ?? null, "Code element must have a `code` string."));
          }
          break;
        case "table":
          errors.push(...validateTableRows(element, path));
          break;
        case "kpiBand":
        case "metadataGrid":
          // An items-less composite is not an error the writer can see: it
          // expands to a table with no rows and renders as a blank rectangle,
          // which is the worst kind of wrong.
          if (!Array.isArray(element.items) || element.items.length === 0) {
            errors.push(err(`${path}/items`, "non-empty array", gettype(element.items ?? null), element.items ?? null, `A \`${element.type}\` must have a non-empty \`items\` array.`));
          }
          break;
      }
    }

    return errors;
  }
}

/**
 * A table row that shares no key with any column. Mirrors PHP
 * `Validator::validateTableRows`.
 *
 * Every cell resolves to nothing and the table still draws at FULL SIZE, because
 * its geometry comes from the columns and the row count. The result is a
 * correctly-shaped grid with every cell blank and nothing raised anywhere -- the
 * same class of wrong as the items-less composite above, and it reached a customer
 * as a table whose rows were empty (fancy-slides#14).
 *
 * Three shapes are NOT this and must not be flagged: a POSITIONAL row (an array,
 * read in column order), a partially-filled row (a missing cell is simply empty),
 * and a row carrying only row-level style. Only an object row that matches NOTHING
 * is unrecoverable -- in practice a mis-cased or renamed key, which is why the hint
 * names the keys that would work.
 */
function validateTableRows(element: Any, path: string): ValidationError[] {
  const rows = element.rows;
  const rawColumns = element.columns;
  if (!Array.isArray(rows) || !Array.isArray(rawColumns) || rawColumns.length === 0) return [];

  const keys = TableResolver.normalizeColumns(rawColumns).map((c) => c.key);
  const ignored = [...STYLE_KEYS, ...ROW_KEYS];
  const errors: ValidationError[] = [];

  rows.forEach((row: Any, i: number) => {
    if (!isPlainObject(row)) return;
    const inner: Any = isPlainObject(row.cells) || Array.isArray(row.cells) ? row.cells : row;
    if (Array.isArray(inner)) return; // positional, read in column order

    const claimed = Object.keys(inner).filter((k) => !ignored.includes(k));
    if (claimed.length === 0 || claimed.some((k) => keys.includes(k))) return;

    errors.push(
      err(
        `${path}/rows/${i}`,
        "at least one key from: " + keys.join(" / "),
        "keys: " + claimed.join(" / "),
        row,
        "No column reads anything from this row, so every cell would render empty at full table size. Key each cell by a column key (" +
          keys.join(", ") +
          "), or give the row as a positional list in column order.",
      ),
    );
  });

  return errors;
}
function err(path: string, expected: string, got: string, value: unknown, hint: string): ValidationError {
  return { path, expected, got, value, hint };
}
