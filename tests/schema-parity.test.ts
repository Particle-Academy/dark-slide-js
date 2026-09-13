import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { Agent, unzipSync } from "../src";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/**
 * What the published schema tells a model about units, and whether it is true.
 *
 * `style` was exported as a bare `{ type: "object" }`. A model filling it in had
 * only the key names, and `fontSize` reads as points while every engine treats
 * it as design pixels and halves it (trap 5). In the fancy-labs document lab an
 * agent described its headline as 232pt and the file carried 116pt.
 *
 * Two guarantees:
 *   - the element position and style schema is IDENTICAL to the PHP reference's,
 *     so the engines cannot describe one field two ways;
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

  it("says fontSize is design pixels halved into points, and the file agrees", () => {
    const description: string = style.properties.fontSize.description;
    expect(description).toContain("DESIGN PIXELS");
    expect(description).toContain("96 is written as 48pt");
    expect(description).toContain("24 as 12pt");
    expect(description).toContain("anything under 16 as 8pt");

    expect(slideXml({ fontSize: 96 })).toContain('sz="4800"');
    expect(slideXml({ fontSize: 24 })).toContain('sz="1200"');
    expect(slideXml({ fontSize: 10 })).toContain('sz="800"');
  });

  it("says which fields are already points, and the file agrees", () => {
    expect(style.properties.letterSpacing.description).toContain("2 is written as 2pt");
    expect(slideXml({ letterSpacing: 2 })).toContain('spc="200"');

    expect(style.properties.spaceBefore.description).toContain("6 is written as 6pt");
    expect(slideXml({ spaceBefore: 6 })).toContain('<a:spcBef><a:spcPts val="600"/></a:spcBef>');

    expect(style.properties.padding.description).toContain("12 is written as 12pt");
    expect(slideXml({ padding: 12 })).toContain('lIns="152400"'); // 12pt x 12700 EMU
  });

  it("says lineHeight is a multiple, and the file agrees", () => {
    expect(style.properties.lineHeight.description).toContain("1.4 is written as 140%");
    expect(slideXml({ lineHeight: 1.4 })).toContain('<a:spcPct val="140000"/>');
  });
});

const HAS_PHP = phpAvailable();

describe.skipIf(!HAS_PHP)("schema parity (PHP vs TS)", () => {
  it("describes element position, size and style exactly as the PHP reference does", () => {
    const reference = elementProps(JSON.parse(php([PHP_SCRIPT])));
    const ours = elementProps(Agent.jsonSchema());

    for (const key of ["x", "y", "w", "h", "style"]) {
      expect(ours[key], `element.${key} differs from the PHP reference`).toEqual(reference[key]);
    }
    // The comparison has to be over something, or it passes on two empty exports.
    expect(Object.keys(reference.style.properties ?? {})).toContain("fontSize");
  });
});

// A missing PHP must never read as a pass in CI; see the same guard in parity.test.ts.
if (process.env.CI && !HAS_PHP) {
  throw new Error(
    "php is not on PATH. The schema parity check compares this export with the PHP reference; " +
      "skipping it in CI would report success with no coverage.",
  );
}
