import { describe, expect, it } from "vitest";
import { Agent, unzipSync } from "../src";
import { MarkdownInline, type InlineRun } from "../src/helpers/markdown-inline";

/**
 * CommonMark backslash escapes in the inline tokenizer.
 *
 * A backslash before any ASCII punctuation character makes that character
 * literal and is itself removed. A backslash before anything else (a letter,
 * a digit, a space, a non-ASCII character, the end of the paragraph) is a
 * literal backslash. Inside a code span nothing is an escape.
 *
 * Mirrors PHP `tests/Unit/MarkdownInlineEscapeTest.php` and Python
 * `tests/test_markdown_inline_escapes.py` row for row; keep the three in step.
 */
const run = (text: string, f: Partial<Omit<InlineRun, "text">> = {}): InlineRun => ({
  text,
  b: f.b ?? false,
  i: f.i ?? false,
  code: f.code ?? false,
});

const cases: Array<[string, string, InlineRun[]]> = [
  ["escaped bold markers are literal asterisks", "\\*\\*not bold\\*\\*", [run("**not bold**")]],
  ["one escaped asterisk then a bold opener", "\\***x**", [run("*"), run("x", { b: true })]],
  ["escaped backticks do not open code", "\\`not code\\`", [run("`not code`")]],
  ["escaped underscores are not italic", "\\_not italic\\_", [run("_not italic_")]],
  ["an escaped asterisk inside bold is literal", "**a \\* b**", [run("a * b", { b: true })]],
  ["a doubled backslash is one literal backslash", "a \\\\ b", [run("a \\ b")]],
  ["an escaped backslash does not escape what follows", "\\\\*x*", [run("\\"), run("x", { i: true })]],
  ["a backslash before a letter is literal", "C:\\path\\to", [run("C:\\path\\to")]],
  ["a backslash before a digit is literal", "v\\2", [run("v\\2")]],
  ["a backslash before a space is literal", "a \\ b", [run("a \\ b")]],
  ["a trailing backslash is literal", "end\\", [run("end\\")]],
  ["a backslash before non-ASCII is literal", "\\é", [run("\\é")]],
  ["a leading escaped hash is a literal hash", "\\# not a heading", [run("# not a heading")]],
  [
    "every ASCII punctuation character escapes",
    "\\!\\\"\\#\\$\\%\\&\\'\\(\\)\\*\\+\\,\\-\\.\\/\\:\\;\\<\\=\\>\\?\\@\\[\\\\\\]\\^\\_\\`\\{\\|\\}\\~",
    [run("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")],
  ],
  ["a backslash inside a code span is literal", "`a\\*b`", [run("a\\*b", { code: true })]],
];

describe("MarkdownInline backslash escapes", () => {
  it.each(cases)("%s", (_name, input, expected) => {
    expect(MarkdownInline.tokenize(input)).toEqual(expected);
  });

  it("writes escaped markers to the pptx as literal text with no backslash", () => {
    const deck = {
      id: "esc",
      title: "Escapes",
      theme: { name: "default" },
      slides: [{ id: "s1", elements: [{
        id: "tx", type: "text", x: 0.1, y: 0.1, w: 0.8, h: 0.2,
        content: "\\*\\*not bold\\*\\* and \\`not code\\`",
        format: "markdown",
      }] }],
    };
    const bytes = Agent.toBytes(deck as never);
    const xml = new TextDecoder().decode(unzipSync(bytes)["ppt/slides/slide1.xml"]!);

    expect(xml).toContain("<a:t>**not bold** and `not code`</a:t>");
    expect(xml).not.toContain("\\");
    expect(xml).not.toContain(' b="1"');
    expect(xml).not.toContain(' i="1"');
    expect(xml).not.toContain("Consolas");

    const read = Agent.read(bytes) as { slides: Array<{ elements: Array<{ content: string }> }> };
    expect(read.slides[0]!.elements[0]!.content).toBe("**not bold** and `not code`");
  });
});
