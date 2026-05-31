import { describe, it, expect } from "vitest";
import { MarkdownInline } from "../src/helpers/markdown-inline";
import { SyntaxHighlighter } from "../src/helpers/syntax-highlighter";
import { ChartTranslator } from "../src/helpers/chart-translator";
import { Color } from "../src/helpers/color";
import { Emu, EMU_PER_INCH, DEFAULT_SLIDE_WIDTH, DEFAULT_SLIDE_HEIGHT } from "../src/helpers/emu";
import { Validator, Repairer } from "../src";

// Unit coverage for the dark-slide helpers, deriving expected values from the
// PHP helper behavior (cross-checked against the PHP sources during authoring).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe("MarkdownInline.tokenize", () => {
  it("splits a bold run from surrounding plain text", () => {
    expect(MarkdownInline.tokenize("a **b** c")).toEqual([
      { text: "a ", b: false, i: false, code: false },
      { text: "b", b: true, i: false, code: false },
      { text: " c", b: false, i: false, code: false },
    ]);
  });

  it("supports __bold__ as well as **bold**", () => {
    const runs = MarkdownInline.tokenize("__x__");
    expect(runs).toEqual([{ text: "x", b: true, i: false, code: false }]);
  });

  it("splits an italic run", () => {
    expect(MarkdownInline.tokenize("this *is* it")).toEqual([
      { text: "this ", b: false, i: false, code: false },
      { text: "is", b: false, i: true, code: false },
      { text: " it", b: false, i: false, code: false },
    ]);
  });

  it("emits a code run that swallows markers literally", () => {
    expect(MarkdownInline.tokenize("call `a**b`")).toEqual([
      { text: "call ", b: false, i: false, code: false },
      { text: "a**b", b: false, i: false, code: true },
    ]);
  });

  it("does NOT treat snake_case underscores as italic", () => {
    expect(MarkdownInline.tokenize("a_b_c snake_case")).toEqual([
      { text: "a_b_c snake_case", b: false, i: false, code: false },
    ]);
    expect(MarkdownInline.tokenize("x_y")).toEqual([{ text: "x_y", b: false, i: false, code: false }]);
  });

  it("renders an unmatched backtick literally (no code run)", () => {
    // The opening backtick flushes the buffer, then the unmatched remainder is
    // appended as plain text — matches PHP: two plain runs, neither code.
    expect(MarkdownInline.tokenize("a `b")).toEqual([
      { text: "a ", b: false, i: false, code: false },
      { text: "`b", b: false, i: false, code: false },
    ]);
  });

  it("returns a single empty run for an empty string", () => {
    expect(MarkdownInline.tokenize("")).toEqual([{ text: "", b: false, i: false, code: false }]);
  });

  it("bulletPrefix detects - and * markers and strips them", () => {
    expect(MarkdownInline.bulletPrefix("- item")).toEqual([true, "item"]);
    expect(MarkdownInline.bulletPrefix("* item")).toEqual([true, "item"]);
    expect(MarkdownInline.bulletPrefix("plain")).toEqual([false, "plain"]);
  });

  it("headingPrefix returns level + stripped content for ATX headings", () => {
    expect(MarkdownInline.headingPrefix("# H1")).toEqual([1, "H1"]);
    expect(MarkdownInline.headingPrefix("### Small")).toEqual([3, "Small"]);
    expect(MarkdownInline.headingPrefix("no heading")).toEqual([0, "no heading"]);
    // mid-line # is not a heading
    expect(MarkdownInline.headingPrefix("text # not")).toEqual([0, "text # not"]);
  });
});

describe("SyntaxHighlighter.tokenize", () => {
  const kindsFor = (code: string, lang: string) =>
    SyntaxHighlighter.tokenize(code, lang).map((t) => [t.text, t.kind]);

  const hasToken = (code: string, lang: string, text: string, kind: string) =>
    SyntaxHighlighter.tokenize(code, lang).some((t) => t.text === text && t.kind === kind);

  it("promotes keywords, strings, comments and numbers in JS/TS", () => {
    expect(hasToken("const x = 1;", "javascript", "const", "keyword")).toBe(true);
    expect(hasToken('"hi"', "javascript", '"hi"', "string")).toBe(true);
    expect(hasToken("// note", "javascript", "// note", "comment")).toBe(true);
    expect(hasToken("42", "typescript", "42", "number")).toBe(true);
    expect(hasToken("console", "javascript", "console", "builtin")).toBe(true);
  });

  it("highlights php / json / python / bash / css / html", () => {
    expect(hasToken("$x = 1;", "php", "// none", "comment")).toBe(false); // sanity
    expect(hasToken("function foo()", "php", "function", "keyword")).toBe(true);
    expect(hasToken('{"a": true}', "json", "true", "keyword")).toBe(true);
    expect(hasToken("def f(): pass", "python", "def", "keyword")).toBe(true);
    expect(hasToken("if true; then echo hi; fi", "bash", "echo", "builtin")).toBe(true);
    expect(hasToken("a { color: red }", "css", "/* */", "comment")).toBe(false); // sanity
    expect(hasToken("/* c */", "css", "/* c */", "comment")).toBe(true);
    expect(hasToken("<div>", "html", "<div", "keyword")).toBe(true);
  });

  it("coalesces consecutive same-kind tokens", () => {
    // "abc" is three plain word chars after keyword classification → one plain run.
    const toks = SyntaxHighlighter.tokenize("abc", "javascript");
    expect(toks).toEqual([{ text: "abc", kind: "plain" }]);
  });

  it("colorFor returns the documented palette", () => {
    expect(SyntaxHighlighter.colorFor("keyword")).toBe("C084FC");
    expect(SyntaxHighlighter.colorFor("string")).toBe("86EFAC");
    expect(SyntaxHighlighter.colorFor("comment")).toBe("64748B");
    expect(SyntaxHighlighter.colorFor("number")).toBe("FBBF24");
    expect(SyntaxHighlighter.colorFor("builtin")).toBe("67E8F9");
    expect(SyntaxHighlighter.colorFor("punctuation")).toBe("CBD5E1");
    expect(SyntaxHighlighter.colorFor("plain")).toBe("F8FAFC");
  });

  it("normalizes language aliases (js→javascript, ts→typescript, etc.)", () => {
    // js alias resolves the JS config → `const` is a keyword.
    expect(hasToken("const x = 1", "js", "const", "keyword")).toBe(true);
    expect(hasToken("const x = 1", "ts", "const", "keyword")).toBe(true);
    expect(hasToken("echo hi", "sh", "echo", "builtin")).toBe(true);
    expect(hasToken("def f()", "py", "def", "keyword")).toBe(true);
    // xml normalizes to html
    expect(hasToken("<a>", "xml", "<a", "keyword")).toBe(true);
  });

  it("returns a single plain token for an unknown language", () => {
    expect(SyntaxHighlighter.tokenize("const x = 1", "brainfuck")).toEqual([{ text: "const x = 1", kind: "plain" }]);
  });
});

describe("ChartTranslator.translate", () => {
  it("extracts a bar chart with categories from xAxis.data", () => {
    const spec = ChartTranslator.translate({
      xAxis: { data: ["Q1", "Q2", "Q3"] },
      series: [{ type: "bar", name: "Rev", data: [10, 20, 30] }],
    })!;
    expect(spec.kind).toBe("bar");
    expect(spec.categories).toEqual(["Q1", "Q2", "Q3"]);
    expect(spec.series[0].values).toEqual([10, 20, 30]);
    expect(spec.series[0].name).toBe("Rev");
  });

  it("extracts a line chart", () => {
    const spec = ChartTranslator.translate({
      xAxis: { data: ["a", "b"] },
      series: [{ type: "line", data: [1, 2], smooth: true }],
    })!;
    expect(spec.kind).toBe("line");
    expect(spec.series[0].smooth).toBe(true);
    expect(spec.series[0].area).toBe(false);
  });

  it("treats line + areaStyle as an area series", () => {
    const spec = ChartTranslator.translate({
      xAxis: { data: ["a", "b"] },
      series: [{ type: "line", data: [1, 2], areaStyle: {} }],
    })!;
    expect(spec.kind).toBe("line");
    expect(spec.series[0].area).toBe(true);
  });

  it("derives pie categories from data {name,value}", () => {
    const spec = ChartTranslator.translate({
      series: [
        {
          type: "pie",
          data: [
            { name: "X", value: 5 },
            { name: "Y", value: 7.5 },
          ],
        },
      ],
    })!;
    expect(spec.kind).toBe("pie");
    expect(spec.categories).toEqual(["X", "Y"]);
    expect(spec.series[0].values).toEqual([5, 7.5]);
  });

  it("extracts scatter points from [x,y] pairs", () => {
    const spec = ChartTranslator.translate({
      series: [
        {
          type: "scatter",
          data: [
            [1, 2],
            [3, 4.5],
          ],
        },
      ],
    })!;
    expect(spec.kind).toBe("scatter");
    expect(spec.series[0].points).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4.5 },
    ]);
  });

  it("returns null for an unsupported series type", () => {
    expect(ChartTranslator.translate({ series: [{ type: "radar", data: [1, 2, 3] }] })).toBeNull();
  });

  it("returns null for empty series", () => {
    expect(ChartTranslator.translate({ series: [] })).toBeNull();
    expect(ChartTranslator.translate({})).toBeNull();
  });

  it("extracts the title from option.title.text", () => {
    const spec = ChartTranslator.translate({
      title: { text: "Quarterly" },
      xAxis: { data: ["a"] },
      series: [{ type: "bar", data: [1] }],
    })!;
    expect(spec.title).toBe("Quarterly");
  });
});

describe("Color.parse", () => {
  it("expands #rgb shorthand", () => {
    expect(Color.parse("#abc")).toEqual(["AABBCC", 100000]);
  });
  it("parses #rrggbb", () => {
    expect(Color.parse("#8B5CF6")).toEqual(["8B5CF6", 100000]);
  });
  it("parses #rrggbbaa into hex + alpha", () => {
    const [hex, a] = Color.parse("#FF000080");
    expect(hex).toBe("FF0000");
    expect(a).toBe(Math.round((0x80 / 255) * 100000));
  });
  it("parses rgb()", () => {
    expect(Color.parse("rgb(255, 0, 0)")).toEqual(["FF0000", 100000]);
  });
  it("parses rgba() with fractional alpha", () => {
    expect(Color.parse("rgba(255,0,0,0.5)")).toEqual(["FF0000", 50000]);
  });
  it("resolves named colors", () => {
    expect(Color.parse("red")).toEqual(["FF0000", 100000]);
    expect(Color.parse("white")).toEqual(["FFFFFF", 100000]);
  });
  it("treats transparent / none as zero alpha on the fallback", () => {
    expect(Color.parse("transparent")).toEqual(["000000", 0]);
    expect(Color.parse("none")).toEqual(["000000", 0]);
  });
  it("returns the fallback for empty/unknown input", () => {
    expect(Color.parse("")).toEqual(["000000", 100000]);
    expect(Color.parse("notacolor")).toEqual(["000000", 100000]);
    expect(Color.parse("", "FF0000")).toEqual(["FF0000", 100000]);
  });
});

describe("Emu", () => {
  it("converts fractions to EMU on each axis", () => {
    expect(Emu.fromFracX(0.5)).toBe(DEFAULT_SLIDE_WIDTH / 2);
    expect(Emu.fromFracY(0.5)).toBe(DEFAULT_SLIDE_HEIGHT / 2);
  });
  it("round-trips EMU back to a fraction", () => {
    expect(Emu.toFracX(DEFAULT_SLIDE_WIDTH / 2)).toBeCloseTo(0.5, 9);
    expect(Emu.toFracY(DEFAULT_SLIDE_HEIGHT)).toBeCloseTo(1, 9);
    expect(Emu.toFracX(123, 0)).toBe(0); // guard against /0
  });
  it("converts points to EMU (72pt = 1 inch)", () => {
    expect(Emu.fromPt(72)).toBe(EMU_PER_INCH);
    expect(Emu.fromPt(36)).toBe(EMU_PER_INCH / 2);
  });
  it("expresses points in hundredths (drawingML sz units)", () => {
    expect(Emu.hundredthsOfPoint(24)).toBe(2400);
    expect(Emu.hundredthsOfPoint(18.5)).toBe(1850);
  });
});

describe("Validator + Repairer", () => {
  const validator = new Validator();
  const repair = (deck: Any) => new Repairer().repair(deck);

  it("flags the missing top-level required keys", () => {
    const errors = validator.validate({ slides: [] });
    const paths = errors.map((e) => e.path);
    expect(paths).toContain("/id");
    expect(paths).toContain("/title");
    expect(paths).toContain("/theme");
  });

  it("liberally accepts a fully-formed deck", () => {
    const deck = {
      id: "d",
      title: "t",
      theme: { name: "default" },
      slides: [
        { id: "s1", layout: "blank", elements: [{ id: "e", type: "text", x: 0.1, y: 0.1, w: 0.5, h: 0.2, content: "hi" }] },
      ],
    };
    expect(validator.validate(deck)).toEqual([]);
  });

  it("repair fills missing ids + theme/title and clamps coords into [0,1]", () => {
    const deck = repair({ slides: [{ elements: [{ type: "text", x: -0.5, y: 1.5, w: 2, h: 0.5, content: "hi" }] }] }) as Any;
    expect(typeof deck.id).toBe("string");
    expect(deck.title).toBe("Untitled");
    expect(deck.theme.name).toBe("default");
    const el = deck.slides[0].elements[0];
    expect(el.x).toBe(0);
    expect(el.y).toBe(1);
    expect(el.w).toBe(1);
    expect(typeof el.id).toBe("string");
    expect(typeof deck.slides[0].id).toBe("string");
  });

  it("repair enforces minimum element dimensions (>= 0.02)", () => {
    const deck = repair({
      slides: [{ elements: [{ type: "shape", shape: "rect", x: 0.1, y: 0.1, w: 0.001, h: 0.0, content: "" }] }],
    }) as Any;
    const el = deck.slides[0].elements[0];
    expect(el.w).toBeGreaterThanOrEqual(0.02);
    expect(el.h).toBeGreaterThanOrEqual(0.02);
  });

  it("repair normalizes an unknown slide layout to blank", () => {
    const deck = repair({ slides: [{ layout: "made-up", elements: [] }] }) as Any;
    expect(deck.slides[0].layout).toBe("blank");
  });

  it("repair drops elements with an unknown / missing type", () => {
    const deck = repair({
      slides: [
        {
          elements: [
            { type: "text", x: 0.1, y: 0.1, w: 0.3, h: 0.2, content: "keep" },
            { type: "bogus", x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
            { x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
          ],
        },
      ],
    }) as Any;
    const els = deck.slides[0].elements;
    expect(els).toHaveLength(1);
    expect(els[0].type).toBe("text");
  });

  it("repair coerces an unknown shape kind to rect", () => {
    const deck = repair({
      slides: [{ elements: [{ type: "shape", shape: "hexagon-of-doom", x: 0.1, y: 0.1, w: 0.3, h: 0.2 }] }],
    }) as Any;
    expect(deck.slides[0].elements[0].shape).toBe("rect");
  });
});
