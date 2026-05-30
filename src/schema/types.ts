/**
 * Public deck types — mirror `@particle-academy/fancy-slides`. Inputs are loose
 * agent JSON, so most fields are optional and extra keys are tolerated; the
 * Validator is the gate.
 */

export type ElementType = "text" | "image" | "chart" | "code" | "table" | "shape" | "embed";

export interface ThemeColors {
  background?: string;
  text?: string;
  muted?: string;
  accent?: string;
  surface?: string;
}
export interface ThemeFonts {
  heading?: string;
  body?: string;
  mono?: string;
}
export interface DeckTheme {
  name: string;
  aspectRatio?: number;
  slideWidth?: number;
  defaultTransition?: Transition;
  colors?: ThemeColors;
  fonts?: ThemeFonts;
  [key: string]: unknown;
}

export interface Transition {
  kind: "none" | "fade" | "slide" | "zoom";
  duration?: number;
  direction?: "left" | "right" | "up" | "down";
}

export interface Animation {
  effect: "fade" | "fly-in" | "zoom" | "wipe";
  trigger?: "on-click" | "with-prev" | "after-prev";
  direction?: "left" | "right" | "up" | "down";
  duration?: number;
  delay?: number;
  order?: number;
  byParagraph?: boolean;
}

export interface SlideElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  z?: number;
  locked?: boolean;
  hidden?: boolean;
  href?: string;
  animation?: Animation;
  // text
  content?: string;
  format?: "markdown" | "html" | "plain";
  style?: Record<string, unknown>;
  // image
  src?: string;
  alt?: string;
  fit?: "fill" | "cover" | "contain" | "scale-down";
  crop?: { x: number; y: number; w: number; h: number };
  // shape
  shape?: "rect" | "rounded-rect" | "ellipse" | "triangle" | "line" | "arrow";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dashed?: boolean;
  radius?: number;
  // code
  code?: string;
  language?: string;
  codeTheme?: string;
  // table
  columns?: { key: string; label: string }[];
  rows?: Record<string, unknown>[];
  // chart
  option?: Record<string, unknown>;
  chartTheme?: string;
  image?: string;
  [key: string]: unknown;
}

export interface SlideBackground {
  color?: string;
  image?: string;
  imageFit?: "contain" | "cover" | "fill";
  gradient?: string;
}

export interface Slide {
  id: string;
  layout?: string;
  elements: SlideElement[];
  background?: SlideBackground;
  transition?: Transition;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface Deck {
  id: string;
  title: string;
  theme: DeckTheme;
  slides: Slide[];
  metadata?: Record<string, unknown>;
}

export interface ValidationError {
  path: string;
  expected: string;
  got: string;
  value: unknown;
  hint: string;
}

export interface RepairResult {
  ok: boolean;
  schema: Record<string, unknown>;
  errors: ValidationError[];
}

export interface WriteResult {
  path: string;
  bytes: number;
  slides: number;
}

export interface WriteOptions {
  tempDir?: string;
  allowHttpImages?: boolean;
}
