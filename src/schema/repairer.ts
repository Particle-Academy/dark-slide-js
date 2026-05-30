import { clone, isNumeric, isPlainObject } from "../util";
import { Schema } from "./schema";

type Any = any;

/** Heuristic deck repair. Mirrors PHP `Schema\Repairer`. Never mutates input. */
export class Repairer {
  private idCounter = 0;

  repair(deckInput: Any): Record<string, unknown> {
    this.idCounter = 0;
    const deck: Any = isPlainObject(deckInput) ? clone(deckInput) : {};

    deck.id ??= this.generateId("deck");
    deck.title ??= "Untitled";
    deck.theme = this.repairTheme(deck.theme ?? null);
    deck.slides = this.repairSlides(deck.slides ?? []);

    return deck;
  }

  private repairTheme(theme: Any): Record<string, unknown> {
    if (!isPlainObject(theme)) return { name: Schema.DEFAULT_THEME_NAME };
    theme.name ??= Schema.DEFAULT_THEME_NAME;
    return theme;
  }

  private repairSlides(slides: Any): Record<string, unknown>[] {
    if (!Array.isArray(slides)) return [];
    const out: Record<string, unknown>[] = [];
    slides.forEach((slide: Any, i: number) => {
      if (!isPlainObject(slide)) return;
      out.push(this.repairSlide(slide, i));
    });
    return out;
  }

  private repairSlide(slide: Any, index: number): Record<string, unknown> {
    slide.id ??= this.generateId("s", index);
    slide.elements = this.repairElements(slide.elements ?? []);
    if (slide.layout !== undefined && !(Schema.SLIDE_LAYOUTS as readonly string[]).includes(slide.layout)) {
      slide.layout = "blank";
    }
    return slide;
  }

  private repairElements(elements: Any): Record<string, unknown>[] {
    if (!Array.isArray(elements)) return [];
    const out: Record<string, unknown>[] = [];
    elements.forEach((element: Any, i: number) => {
      if (!isPlainObject(element)) return;
      const repaired = this.repairElement(element, i);
      if (repaired !== null) out.push(repaired);
    });
    return out;
  }

  private repairElement(element: Any, index: number): Record<string, unknown> | null {
    if (element.type === undefined || !(Schema.ELEMENT_TYPES as readonly string[]).includes(element.type)) {
      return null;
    }

    element.id ??= this.generateId("e", index);

    for (const coord of ["x", "y", "w", "h"] as const) {
      element[coord] = this.clamp(isNumeric(element[coord]) ? Number(element[coord]) : 0, 0, 1);
    }
    if (element.w < 0.02) element.w = 0.02;
    if (element.h < 0.02) element.h = 0.02;

    switch (element.type) {
      case "text":
        element.content = typeof element.content === "string" ? element.content : "";
        break;
      case "image":
        element.src = typeof element.src === "string" ? element.src : "";
        break;
      case "shape":
        element.shape =
          typeof element.shape === "string" && (Schema.SHAPE_KINDS as readonly string[]).includes(element.shape)
            ? element.shape
            : "rect";
        break;
      case "code":
        element.code = typeof element.code === "string" ? element.code : "";
        break;
    }

    return element;
  }

  private generateId(prefix: string, index = 0): string {
    this.idCounter++;
    const t = (Math.floor(Date.now() / 1000) & 0xffffff).toString(16);
    const n = String(this.idCounter + index).padStart(3, "0");
    return `${prefix}-${t}-${n}`;
  }

  private clamp(v: number, min: number, max: number): number {
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.min(max, v));
  }
}
