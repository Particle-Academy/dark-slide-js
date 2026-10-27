export { Agent, VERSION, convertTemplate } from "./agent";
export { DarkSlide } from "./dark-slide";
export { SchemaException, ArchiveRefused, OfficeTemplateRefused } from "./exceptions";
export type { SourceKind } from "./zip/office-template";
export type { ArchiveLimits } from "./zip/source-archive";
export { FontEmbeddingException } from "./fonts/font-embedding-exception";
export { EmbeddedFonts, FONT_VARIANTS, type FontOptions, type FontSource, type FontVariant } from "./fonts/embedded-fonts";
export { DesignUnits } from "./helpers/design-units";
export { lintDeck, type LintFinding } from "./lint";
export * from "./schema/types";

// Lower-level building blocks (advanced use / parity with PHP services).
export { Validator } from "./schema/validator";
export { Repairer } from "./schema/repairer";
export { Schema } from "./schema/schema";
export { PptxWriter } from "./writer/pptx-writer";
export { PptxReader } from "./reader/pptx-reader";
export { zipSync, unzipSync, type ZipFile } from "./zip";
