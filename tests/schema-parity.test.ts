import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { Agent, unzipSync } from "../src";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/**
 * What the published schema tells a model about units, and whether it is true.
 *
 * `style` was exported as a bare `{ type: "object" }` until 0.7.2. A model
 * filling it in had only the key names, and `fontSize` reads as points: in the
 * fancy-labs document lab an agent described its headline as 232pt and the file
 * carried 116pt. 0.8 gave every length in the object one unit, the design pixel,
 * and the descriptions say so with worked examples.
 *
 * Two guarantees:
 *   - the element position/size/style/strokeWidth schema and the theme's canvas
 *     fields are IDENTICAL to the PHP reference's, so the engines cannot describe
 *     one field two ways;
 *   - the worked examples those descriptions quote are what THIS writer emits.
 */

const PHP_SCRIPT = join(__dirname, "..", "scripts", "php-jsonschema.php");

function php(args: string[]): string {
  return (execFileSync("php", args, { shell: true }) as Buffer).toString("utf8");
}

function phpAvailable(): boolean {
  try {
    execFileSync("php", ["--version"], { shell: true, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const elementProps = (schema: Any): Any => schema.properties.slides.items.properties.elements.items.properties;
const themeProps = (schema: Any): Any => schema.properties.theme.properties;

function slideXml(style: Record<string, unknown>): string {
  const bytes = Agent.toBytes({
    id: "units",
    title: "Style units",
    theme: { name: "default" },
    slides: [
      {
        id: "s1",
        elements: [
          { id: "t", type: "text", x: 0.1, y: 0.1, w: 0.5, h: 0.3, content: "First paragraph\nSecond paragraph", style },
        ],
      },
    ],
  });

  return new TextDecoder().decode(unzipSync(bytes)["ppt/slides/slide1.xml"]!);
}

describe("style units in the published schema", () => {
  const style = elementProps(Agent.jsonSchema()).style;

  it("says every length is a design pixel on the canvas", () => {
    expect(style.description).toContain("DESIGN PIXELS");
    expect(style.description).toContain("points = px x 720 / slideWidth");
    for (const key of ["letterSpacing", "spaceBefore", "spaceAfter", "radius", "padding"]) {
      expect(style.properties[key].description, key).toContain("design pixels");
    }
  });

  it("says what fontSize is written as, and the file agrees", () => {
    const description: string = style.properties.fontSize.description;
    expect(description).toContain("96 is written as 36pt");
    expect(description).toContain("28 as 10.5pt");
    expect(description).toContain("never below 1pt");
    expect(description).toContain("Default 28");

    expect(slideXml({ fontSize: 96 })).toContain('sz="3600"');
    expect(slideXml({ fontSize: 28 })).toContain('sz="1050"');
    expect(slideXml({})).toContain('sz="1050"');
    expect(slideXml({ fontSize: 2 })).toContain('sz="100"');
  });

  it("says what the other lengths are written as, and the file agrees", () => {
    expect(style.properties.letterSpacing.description).toContain("8 is written as 3pt");
    expect(slideXml({ letterSpacing: 8 })).toContain('spc="300"');

    expect(style.properties.spaceBefore.description).toContain("16 is written as 6pt");
    expect(slideXml({ spaceBefore: 16 })).toContain('<a:spcBef><a:spcPts val="600"/></a:spcBef>');

    expect(style.properties.padding.description).toContain("32 is written as 12pt");
    expect(slideXml({ padding: 32 })).toContain('lIns="152400"'); // 12pt x 12700 EMU
  });

  it("says lineHeight is a multiple, and the file agrees", () => {
    expect(style.properties.lineHeight.description).toContain("1.4 is written as 140%");
    expect(slideXml({ lineHeight: 1.4 })).toContain('<a:spcPct val="140000"/>');
  });
});

const HAS_PHP = phpAvailable();

describe.skipIf(!HAS_PHP)("schema parity (PHP vs TS)", () => {
  it("describes element position, size, style and outline, and the theme canvas, exactly as the PHP reference does", () => {
    const reference = JSON.parse(php([PHP_SCRIPT]));
    const ours = Agent.jsonSchema();

    for (const key of ["x", "y", "w", "h", "style", "strokeWidth"]) {
      expect(elementProps(ours)[key], `element.${key} differs from the PHP reference`).toEqual(elementProps(reference)[key]);
    }
    for (const key of ["slideWidth", "aspectRatio"]) {
      expect(themeProps(ours)[key], `theme.${key} differs from the PHP reference`).toEqual(themeProps(reference)[key]);
    }
    // The comparison has to be over something, or it passes on two empty exports.
    expect(Object.keys(elementProps(reference).style.properties ?? {})).toContain("fontSize");
    expect(themeProps(reference).slideWidth.description).toContain("1920");
  });
});

// A missing PHP must never read as a pass in CI; see the same guard in parity.test.ts.
if (process.env.CI && !HAS_PHP) {
  throw new Error(
    "php is not on PATH. The schema parity check compares this export with the PHP reference; " +
      "skipping it in CI would report success with no coverage.",
  );
}
