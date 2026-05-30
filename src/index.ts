export { Agent, VERSION } from "./agent";
export { DarkSlide } from "./dark-slide";
export { SchemaException } from "./exceptions";
export * from "./schema/types";

// Lower-level building blocks (advanced use / parity with PHP services).
export { Validator } from "./schema/validator";
export { Repairer } from "./schema/repairer";
export { Schema } from "./schema/schema";
export { PptxWriter } from "./writer/pptx-writer";
export { PptxReader } from "./reader/pptx-reader";
export { zipSync, unzipSync, type ZipFile } from "./zip";
