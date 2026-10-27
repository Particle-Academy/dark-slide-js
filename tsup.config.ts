import { defineConfig } from "tsup";

export default defineConfig({
  // cli.ts is the `dark-slide` bin (Node only). No code splitting, so index.js
  // stays one self-contained file exactly as before the CLI existed.
  entry: ["src/index.ts", "src/cli.ts"],
  splitting: false,
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  // Isomorphic build: keep node builtins external so the dynamic `import("node:fs")`
  // in the file-I/O helpers stays a runtime import (and never ships to browsers).
  platform: "neutral",
  external: ["node:fs", "node:path", "node:os", "node:crypto"],
  treeshake: true,
});
