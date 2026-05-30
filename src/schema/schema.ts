/**
 * Schema constants describing the Deck shape. Mirrors PHP `Schema\Schema`
 * (and `@particle-academy/fancy-slides` types.ts).
 */
export const Schema = {
  VERSION: "0.1.0",

  ELEMENT_TYPES: ["text", "image", "chart", "code", "table", "shape", "embed"] as const,
  SLIDE_LAYOUTS: [
    "blank",
    "title",
    "title-content",
    "two-column",
    "section-divider",
    "image-text",
    "text-image",
    "quote",
  ] as const,
  SHAPE_KINDS: ["rect", "rounded-rect", "ellipse", "triangle", "line", "arrow"] as const,
  TEXT_FORMATS: ["markdown", "html", "plain"] as const,
  SLIDE_TRANSITION_KINDS: ["none", "fade", "slide", "zoom"] as const,
  SLIDE_TRANSITION_DIRECTIONS: ["left", "right", "up", "down"] as const,
  ANIMATION_EFFECTS: ["fade", "fly-in", "zoom", "wipe"] as const,
  ANIMATION_TRIGGERS: ["on-click", "with-prev", "after-prev"] as const,
  ANIMATION_DIRECTIONS: ["left", "right", "up", "down"] as const,
  ANIMATION_DEFAULT_DURATION_MS: 500,
  DEFAULT_SLIDE_WIDTH_EMU: 9144000,
  DEFAULT_SLIDE_HEIGHT_EMU: 5143500,
  DEFAULT_THEME_NAME: "default",

  deckRequiredKeys(): string[] {
    return ["id", "title", "slides", "theme"];
  },
  slideRequiredKeys(): string[] {
    return ["id", "elements"];
  },
  elementRequiredKeys(): string[] {
    return ["id", "type", "x", "y", "w", "h"];
  },

  jsonSchema(): Record<string, unknown> {
    return {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "DarkSlide Deck",
      type: "object",
      required: this.deckRequiredKeys(),
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        theme: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            aspectRatio: { type: "number" },
            slideWidth: { type: "number" },
            colors: {
              type: "object",
              properties: {
                background: { type: "string" },
                text: { type: "string" },
                muted: { type: "string" },
                accent: { type: "string" },
                surface: { type: "string" },
              },
            },
            fonts: {
              type: "object",
              properties: {
                heading: { type: "string" },
                body: { type: "string" },
                mono: { type: "string" },
              },
            },
          },
        },
        slides: {
          type: "array",
          items: {
            type: "object",
            required: this.slideRequiredKeys(),
            properties: {
              id: { type: "string" },
              layout: { type: "string", enum: this.SLIDE_LAYOUTS },
              elements: { type: "array", items: elementJsonSchema() },
              background: {
                type: "object",
                properties: {
                  color: { type: "string" },
                  image: { type: "string" },
                  imageFit: { type: "string", enum: ["contain", "cover", "fill"] },
                  gradient: { type: "string" },
                },
              },
              transition: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: this.SLIDE_TRANSITION_KINDS },
                  duration: { type: "number" },
                  direction: { type: "string", enum: this.SLIDE_TRANSITION_DIRECTIONS },
                },
              },
              notes: { type: "string" },
              metadata: { type: "object" },
            },
          },
        },
        metadata: { type: "object" },
      },
    };
  },
};

function elementJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: Schema.elementRequiredKeys(),
    properties: {
      id: { type: "string" },
      type: { type: "string", enum: Schema.ELEMENT_TYPES },
      x: { type: "number", minimum: 0, maximum: 1 },
      y: { type: "number", minimum: 0, maximum: 1 },
      w: { type: "number", minimum: 0, maximum: 1 },
      h: { type: "number", minimum: 0, maximum: 1 },
      rotation: { type: "number" },
      z: { type: "integer" },
      locked: { type: "boolean" },
      hidden: { type: "boolean" },
      href: { type: "string" },
      content: { type: "string" },
      format: { type: "string", enum: Schema.TEXT_FORMATS },
      style: { type: "object" },
      src: { type: "string" },
      alt: { type: "string" },
      fit: { type: "string", enum: ["contain", "cover", "fill", "scale-down"] },
      shape: { type: "string", enum: Schema.SHAPE_KINDS },
      fill: { type: "string" },
      stroke: { type: "string" },
      strokeWidth: { type: "number" },
      dashed: { type: "boolean" },
      radius: { type: "number" },
      code: { type: "string" },
      language: { type: "string" },
      codeTheme: { type: "string" },
      columns: { type: "array" },
      rows: { type: "array" },
      option: { type: "object" },
      chartTheme: { type: "string" },
      animation: {
        type: "object",
        required: ["effect"],
        properties: {
          effect: { type: "string", enum: Schema.ANIMATION_EFFECTS },
          trigger: { type: "string", enum: Schema.ANIMATION_TRIGGERS },
          direction: { type: "string", enum: Schema.ANIMATION_DIRECTIONS },
          duration: { type: "number" },
          delay: { type: "number" },
          order: { type: "number" },
          byParagraph: { type: "boolean" },
        },
      },
    },
  };
}
